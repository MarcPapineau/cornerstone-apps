# Vitalis Reliability Architecture

Part of the Vitalis anti-drift research sprint · Research lead: Daniel · 2026-06-03 · Research-only — no product code changed.

This document describes the **target build architecture** that makes the seven known Vitalis agent failure modes (F1–F7) machine-checkable instead of relying on agent goodwill. It is written for an operator (Marc), not as an AI-safety essay. Every recommendation traces back to closing one of the seven failure-to-requirement pairs, and the governing bias is **reuse > rebuild**: Vitalis already owns most of the enforcement primitives the literature prescribes, so the sprint is **extension, not greenfield**.

**Stack reality (verified 2026-06-03 against the live repo):** Node/JS (CommonJS server), React + Vite + Tailwind, Express (`server.js`), the canonical engine package `@vitalis/protocol-core` (resolved at `/Users/marcpapineau/.openclaw/workspace/packages/protocol-core/`), a single prebuild gate (`scripts/check-catalog-guard.cjs`, wired as the npm `prebuild` hook), and a dependency-free acceptance suite (`test/acceptance.js`, run via `npm test` → `node test/acceptance.js`).

> **Correction to the scout/KB narrative — read this first (conductor reconciliation, verified on disk 2026-06-03).** `@playwright/test ^1.59.1` **is** installed at the outer `luke-app` repo root (`luke-app/package.json` devDeps + `package-lock.json` + `node_modules`), and a root `playwright.config.js` exists — **but it targets a *separate* app** (`testDir: ./tests`, `baseURL: :3000`, screenshots off), **not** Vitalis. The Vitalis subproject (`vitalis-resource-app/`) has **no visual-QA config, harness, or baselines** of its own; its only automated check is the plain-node acceptance suite. This sharpens the conclusion: the doctrine-mandated §8 visual gate is fully manual for Vitalis today. The **dependency is ~free**, but the **Vitalis visual harness (a config targeting :5173 + baselines) is a genuine low-cost NEW build** — the single highest-leverage net-new capability (closes **F5**).

Maturity, Vitalis-fit, and source links below are carried over from Daniel's consolidated KB **verbatim**. `vendor claim` and `UNKNOWN` labels are preserved. Production-ready/mature is separated from experimental, and immediate from long-term, throughout.

---

## 1. Architecture overview

The reliability architecture is a set of **gates** wrapped around the existing canonical engine and approval flow. Nothing here changes what Vitalis *produces*; it changes what Vitalis will *let through*. An agent (or a human) can only get a protocol from DRAFT to a client-visible APPROVED_RESOURCE by passing each gate in order. Most gates already exist — the new work bolts machine checks onto the points where drift currently slips through (the manual visual step, structural validation, trajectory proof).

The twelve components map onto three reliability themes from the failure map:

- **Source-of-truth integrity** (F1, F3, F6) → the source-of-truth registry, doctrine files, prompt preamble, and structured-output validation.
- **Content fidelity vs compliance** (F4) → the eval suite + visual QA, with softening allowed *only* at the approved client-projection boundary.
- **Process & proof discipline** (F2, F5, F7) → agent handoff logs, the drift incident log, CI/build/test gates, browser visual QA + screenshot comparison, and the human approval gate.

```text
                       ┌─────────────────────────────────────────────────────────┐
                       │  STANDING ORDERS (machine-loaded every session)          │
                       │  AGENTS.md / CLAUDE.md  +  3 doctrine .md files           │  (§3, §4)
                       │  "BLEND_SCHEDULES/selectedScheduleFor/blendScheduleFor    │
                       │   are the ONLY dosing authority; research-doctrine.js RO" │
                       └───────────────┬─────────────────────────────────────────┘
                                       │ injected as locked ground truth
                                       v
   ┌───────────────┐   Start Gate   ┌──────────────────┐  read-only specialists  ┌──────────────────┐
   │  SOURCE-OF-   │  (structured,  │  PROMPT PREAMBLE │  Source-Extraction  →   │  AGENT HANDOFF   │
   │  TRUTH        │◄─ Zod-valid ──►│  SYSTEM          │  Current-System-Map →   │  LOGS            │
   │  REGISTRY     │   F1,F6)       │  (4-element spec)│  Implementation →       │  (write-ahead    │
   │ protocol-core │                │      §4          │  QA/Visual              │  intent log)     │
   │ research-     │                └────────┬─────────┘      §2, §7              │   §9  F2,F5,F7   │
   │ doctrine.js   │                         │                                   └────────┬─────────┘
   │   §2  F1,F3,F6│                         v                                            │
   └───────┬───────┘                ┌──────────────────┐                                  │
           │                        │ STRUCTURED OUTPUT│  Zod v4 + Anthropic              │
           │   single dosing        │ VALIDATION       │  output_config.format            │
           │   authority            │  §8  F3,F4,F6     │  + Ajv-standalone in guard       │
           │                        └────────┬─────────┘                                  │
           v                                 v                                            v
   ┌──────────────────────────────────────────────────────────────────────────────────────────┐
   │  CI / BUILD / TEST GATES  (§11)                                                            │
   │  prebuild: check-catalog-guard.cjs (+Ajv schema, +grep "no dosing outside protocol-core") │
   │  npm test: acceptance.js  ──►  EVAL SUITE (§5): promptfoo trajectory:tool-used,            │
   │                                pass^k multi-run, invocation-count assert, llm-rubric       │
   │  Knip (orphan parallel files) · Changesets (rationale on protocol-core) · Spectral (JSON)  │
   │  VISUAL QA (§6) Playwright toHaveScreenshot  ──►  SCREENSHOT COMPARISON (§7) vs Eric PDF   │
   └───────────────────────────────────────────────┬──────────────────────────────────────────┘
                                                    │ all gates green + visual artifact attached
                                                    v
                              ┌────────────────────────────────────────┐
                              │  HUMAN APPROVAL GATE  (§12)             │
                              │  DRAFT ──► APPROVED_RESOURCE            │
                              │  gates.clientProtocolProjection         │
                              │  server-side; only server resumes;      │
                              │  softening happens HERE and ONLY here   │
                              │   F4,F5  (acceptance test N3)            │
                              └────────────────────────────────────────┘
                                                    │ on retry-exhaustion / fail
                                                    v
                              ┌────────────────────────────────────────┐
                              │  DRIFT INCIDENT LOG (§10) + DLQ         │
                              │  failed_generations table → Telegram    │
                              │  @NehemiahMarcBot (chat 8617287533)     │
                              └────────────────────────────────────────┘
```

**The single most important design principle:** enforcement lives in deterministic code the agent cannot edit (the prebuild guard, the acceptance suite, the server-side projection, the tool-permission list), **not in the prompt**. Prompts are suggestions; gates are enforcement. ([AWS/DEV neurosymbolic guardrails](https://dev.to/aws/ai-agent-guardrails-rules-that-llms-cannot-bypass-596d), 2025-03-10, emerging.)

---

## 2. Source-of-truth registry

**What it is.** A single, authoritative place that owns each kind of fact, plus a guard that fails the build if a *second* authority appears. For Vitalis the registries already exist: the canonical dosing engine (`BLEND_SCHEDULES`, `selectedScheduleFor`, `blendScheduleFor` in `packages/protocol-core/data/dosing.js`, consumed — not re-implemented — by `generator.js` and `document-model.js`) and the research doctrine registry (`research-doctrine.js`: `EXCLUDED_IDS`, `isEvidenceAuthority=false`, `appFacingRegistry`, `SOURCE_LANES`, `HONEST_LABELS`). The job of this component is to make "there is exactly one of each" a machine-checkable fact, and to make the registry the payload an agent reads at the *start* of every job rather than recalls from memory.

**Recommended tools (all production-ready, JS-native, ADOPT NOW):**

- **Zod v4** — express the `BLEND_SCHEDULES` shape + approval whitelist as one canonical schema every agent must satisfy; `z.infer` keeps TS types and runtime validation in one source; v4 adds JSON-Schema export. Verified v4.4.3 (May 4 2026), MIT, ESM **+ CJS**. [github.com/colinhacks/zod](https://github.com/colinhacks/zod). Maturity: **production**. Vitalis fit **HIGH → F3/F6**. Complexity: low.
- **Ajv (standalone mode)** — lets `check-catalog-guard.cjs` validate compound/protocol objects against a *declared JSON Schema* instead of ad-hoc string checks; standalone compiles schemas to pure-JS functions shippable inside the prebuild gate. Verified v8.20.0 (Apr 24 2026), MIT, CommonJS `require()` confirmed, drafts 06→2020-12. [github.com/ajv-validator/ajv](https://github.com/ajv-validator/ajv). Maturity: **production**. Vitalis fit **HIGH → F1/F3**. Complexity: low.
- **Knip** — CI step that surfaces an orphaned parallel dosing file an agent created that nothing imports (the silent form of F3). Verified v6, ISC, monorepo-aware, Vite/Vitest plugins. [knip.dev](https://knip.dev/). Maturity: **production**. Vitalis fit **HIGH → F3**. Complexity: low.

**Already exists in Vitalis vs New.**
- *Already exists (REUSE/EXTEND):* the canonical dosing engine and `research-doctrine.js` registry. **Extend** the dosing engine with invocation-count logging (see §5) and `trajectory:tool-used` assertions; **use** `research-doctrine.js` content as the "context" payload for a grounding gate (see §5) while keeping RD1–RD4 as hard stops.
- *New:* the Zod canonical schema for `BLEND_SCHEDULES` + approval whitelist; Ajv-standalone inside the prebuild guard; the Knip CI step; and a grep gate asserting *no file outside `protocol-core` defines a dosing schedule*.

**Closes:** F3 (parallel dosing system), F1 (ignored standard), F6 (memory over reading).

---

## 3. Doctrine files

**What it is.** The human-readable rules that define the standard. Vitalis already has the strongest version of this of any system in the workspace: `VITALIS-BUILD-PROTOCOL.md` (Start Gate §2, No Solo Patching §1, Agent Routing §3, Drift Triggers §4, Protocol Document Rule §5, Visual Acceptance Gate §8, Done Definition §9), `vitalis-research-doctrine.md` (source lanes, honest labels, dosing source-of-truth, RD1–RD4 enforcement), and `DEVELOPER-HANDOFF.md` (the Eric PDF / LIVE peptide dossier as the "visual north star," silo status). These are verified present in `docs/`.

The reliability gap is not the *content* of these files — it is that they are read by humans and hoped-for by agents, not loaded as machine constraints. The fix is to mirror them into a machine-loaded standing-orders file (see §4) and to make the Start Gate a *validated structured artifact* rather than free prose.

**Recommended practice (no new tool; doctrine-as-executable-truth):**

- **Spec-as-executable-truth** — CI gates enforce the spec. Vitalis already does this with `check-catalog-guard.cjs` + RD1–RD4; extend it (grep forbidden-pattern gate; JSON-Schema check on `BLEND_SCHEDULES`; wire the suite as a *blocking* CI gate on agent PRs). [Spec-Driven Development](https://medium.com/@nprasads/spec-driven-development-in-the-age-of-ai-from-specs-as-documents-to-specs-as-executable-truth-9b9e066712b1) (2026-02-04, emerging). Closes F1, F3, F5.
- **Living spec with protected-decision markers** — add `DECISIONS.json` / `locked:true` markers to `BLEND_SCHEDULES` compound dosing params with rationale; any agent PR touching a locked entry triggers human review. [Augment Code living specs](https://www.augmentcode.com/guides/living-specs-for-ai-agent-development) (2026-03-20, emerging). Closes F1, F4, F6.

**Already exists in Vitalis vs New.**
- *Already exists (REUSE):* all three doctrine `.md` files, verified in `docs/`.
- *New:* a machine-loaded mirror (§4); a structured/validated Start Gate artifact (required non-empty / UNKNOWN-flagged fields, see §8); optional `DECISIONS.json` locked-decision markers.

**Closes:** F1, F2, F5, F7 (the rules these docs already encode) — made enforceable by §4, §5, §8, §11.

---

## 4. Prompt preamble system

**What it is.** The instructions injected at the *top* of every agent session so canonical constraints are loaded before reasoning starts (fighting "context rot," where canon recalled from earlier in a long session is wrong). Vitalis already has `VITALIS-AGENT-PROMPT-PREAMBLE.md` (verified in `docs/`: the "conductor, not the whole build team" rule, rule 1 no solo-patch, rule 2 no coding from memory, rule 3 no softer compliance version, rule 5 no "tests pass = done"). The architecture turns this from a doc a human pastes into a machine-loaded `AGENTS.md` / `CLAUDE.md` standing-orders file plus a structured per-subagent spec.

**Recommended practices (established Anthropic guidance + the Claude Agent SDK already in use):**

- **AGENTS.md / CLAUDE.md standing orders** — a root file declaring: `blendScheduleFor`/`selectedScheduleFor` are the ONLY dosing authorities; `research-doctrine.js` is read-only; the approval gate is server-enforced; plus a forbidden-string list mirroring `check-catalog-guard.cjs`. **Update after every observed F1/F3/F4/F6.** [Anthropic context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) (2025-09-29, established). Closes F1, F2, F3, F6.
- **4-element subagent spec** (objective / output format / tools+sources / boundaries) — without it, subagents "duplicate work or leave gaps." [Anthropic multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) (2025-06-13, established). Closes F2, F3.
- **Canonical-source injection** — the orchestrator is the single reader of canonical sources (reads `research-doctrine.js` + the relevant `BLEND_SCHEDULES` entry + guard output **before** spawning subagents) and forwards verified payloads; subagents do not self-source. [Anthropic Managed Agents](https://platform.claude.com/docs/en/managed-agents/multi-agent) (date UNKNOWN, established). Closes F1, F6.
- **Domain-guideline prioritization** — prompts must state Vitalis rules **supersede** general medical knowledge (conflict hierarchy), and inject relevant `research-doctrine.js` rules inline every call. Academic grounding for F1. [GuideBench, Diao et al., arXiv 2505.11368](https://arxiv.org/abs/2505.11368) (2025-05-16, **preprint**, emerging). Closes F1, F6, F4.
- **Context-rot mitigation** — dosing-engine output, doctrine assertions, and blend schedules must be **JIT-fetched per generation**, never recalled from earlier in a session. [Chroma context-rot](https://www.trychroma.com/research/context-rot) (2025-07-14, established). Closes F6.

**Already exists in Vitalis vs New.**
- *Already exists (REUSE):* `VITALIS-AGENT-PROMPT-PREAMBLE.md`.
- *New:* the machine-loaded `AGENTS.md`/`CLAUDE.md` mirror; the 4-element spec applied to each read-only specialist; JIT injection of the serialized schedule object (not just the function name) into every prompt — the "Enhanced Data Registry" pattern from [Freeman et al., arXiv 2603.10047](https://arxiv.org/abs/2603.10047) (2026-03-08, **preprint**, emerging).

**Closes:** F1, F3, F6 (and F2/F7 via the subagent spec).

---

## 5. Eval suite

**What it is.** The automated test layer that proves the agent did the right thing — not just produced plausible text. Vitalis already has the dependency-free acceptance suite (`test/acceptance.js`, 75/75 per handoff, with honest range/UNKNOWN asserts such as reta `/2–4 mg/` and adipotide UNKNOWN, plus RD1–RD4 and the two-tier client-projection test N3). The architecture **extends this same file/pattern** with three classes of check the literature shows are necessary: trajectory (did it call the canonical engine?), procedure-aware (did it call it even if the answer happened to be right?), and multi-run consistency (is a single green pass actually reliable?).

**Recommended tool (production-ready, JS-native, ADOPT NOW):**

- **promptfoo** — declarative YAML/JS eval with a CI gate; the **`trajectory:tool-used` / `trajectory:tool-sequence`** assertion mechanically asserts the agent invoked the canonical dosing engine rather than a parallel one; `agent-rubric`/`llm-rubric` graders catch softened language; `--fail-on-error` exits non-zero. MIT, OpenAI-acquired but still OSS — verified; **~21.8k GitHub stars confirmed**, while the "350k+ developers / used by Anthropic" figures are promptfoo's own marketing **(vendor claim)**, not independently reproduced. The load-bearing part — the `trajectory:tool-used` assertion — is documented. Slots into the existing `node test/acceptance.js` pattern. Verified v0.121.14 (Jun 2 2026), Node ≥20.20. [github.com/promptfoo/promptfoo](https://github.com/promptfoo/promptfoo). Maturity: **production**. Vitalis fit **HIGH → F1/F3/F4/F5**. Complexity: low.

**Recommended test-harness practices (cheap changes to the existing suite, ADOPT NOW):**

- **Procedure-Aware Evaluation** — instrument `selectedScheduleFor`/`blendScheduleFor` to log invocation counts per job; assert `invocation_count > 0` for every generation. Catches F3 *even when a parallel path accidentally produces the right output* (study: 27–78% of benchmark "successes" violate procedure). [Cao et al., arXiv 2603.03116](https://arxiv.org/abs/2603.03116) (2026-03-03, **preprint**, experimental). Closes F5, F3, F1.
- **pass^k reliability testing** — run any dosing/compound/protocol test **5+ times** and require a consistent pass + track variance; a single stochastic pass is not evidence of canonical-standard adherence. [tau-bench, Yao et al., arXiv 2406.12045](https://arxiv.org/abs/2406.12045) (2024-06-17, **ICLR peer-reviewed**, established). Closes F5, F1.
- **Evaluator-optimizer used sparingly** — Vitalis's deterministic gates (the suite, `check-catalog-guard.cjs`, RD1–RD4) ARE the correct evaluator; an LLM-evaluator on top creates F5. Use LLM eval only for non-verifiable voice/specificity and **cap at 2 rounds** (Snorkel 2025: self-critique dropped accuracy to ~57% where the generator already hit ~98%). [Anthropic, Building Effective Agents](https://www.anthropic.com/research/building-effective-agents) (2024-12-19) + [AgentPatterns.ai](https://www.agentpatterns.ai/agent-design/evaluator-optimizer/) (2026-05-27), established. Closes F5.
- **LLM-as-judge bias control** — any Vitalis LLM-judge must include explicit budget/length constraints and score procedural compliance independently of prose, else a style-biased judge rates verbose hedged text (the F4 failure) as higher quality. [Soumik, arXiv 2604.23178](https://arxiv.org/abs/2604.23178) (2026-04-25, **preprint**) + [Shi et al., arXiv 2406.07791](https://arxiv.org/abs/2406.07791) (AACL-IJCNLP 2025, peer-reviewed), emerging. Closes F4, F5.

**ADOPT LATER (grounding gate, real value, more setup):**
- **Patronus Lynx** — 8B/70B RAG-hallucination model, binary pass/fail vs context, **official TS SDK (v0.3.0)** + REST; run as a post-generation gate before DRAFT→APPROVED scoring protocol text against `research-doctrine.js` content as context. freemium ($10/1k calls; $10 free). [docs.patronus.ai/.../Lynx/base](https://docs.patronus.ai/docs/research_and_differentiators/Lynx/base). Maturity: **production**. Vitalis fit **HIGH (LATER) → F6/F1**.

**AVOID-OVERKILL / wrong stack:** DeepEval (Python primary), LangSmith (hosted-only — protocol traces leave the stack), Inspect/Ragas/TruLens/Cleanlab (Python-only or not-RAG), Braintrust/Patronus Percival (hosted-SaaS / Percival is a trace debugger, not a general evaluator, per [D]). **Galileo "Context Adherence" reliance — UNKNOWN:** the JS SDK is real (Apache-2.0, v2.2.0 May 2026) but the specific Context Adherence metric is **NOT confirmed in live JS docs** — do not build on it until verified ([github.com/rungalileo/galileo-js](https://github.com/rungalileo/galileo-js)).

**Already exists in Vitalis vs New.**
- *Already exists (REUSE/EXTEND):* `test/acceptance.js` (output correctness, RD1–RD4, honest labels, N3). **Extend** with promptfoo assertions, pass^k multi-run, invocation-count asserts; wire as a **blocking** CI gate on agent PRs.
- *New:* promptfoo dependency + config; the invocation-count instrumentation; (later) the Lynx grounding gate.

**Closes:** F1, F3, F4, F5.

---

## 6. Browser visual QA

**What it is.** A repeatable harness that renders the actual React app in a browser and produces a screenshot artifact, so "done" can require visual proof — not just green tests. This is the **#1 net-new gap.** The doctrine mandates it (§8 Visual Acceptance Gate, §9 Done Definition: "Never call a task complete because the code compiles"), but there is **no automated visual harness** today — only the plain-node suite. That manual gate is exactly the surface where "tests pass = done" (F5) recurs.

> **Stack correction (verified on disk):** `@playwright/test` **is** installed at the outer `luke-app` root, but its root `playwright.config.js` targets a *separate* app, not Vitalis — the Vitalis subproject has no config/harness/baselines of its own. So the **dependency is ~free**, but the **Vitalis visual harness is a low-cost NEW build**, not a reuse of an existing Vitalis harness. Playwright remains the right choice — the most direct, JS-native way to close F5 without adding a second browser-automation stack.

**Recommended tool (production-ready, JS-native, ADOPT NOW):**

- **Playwright `toHaveScreenshot`** — pixel-diffs rendered React pages vs committed baselines, uploads expected/actual/diff on mismatch, exit-1 gates CI. **Verified on the live docs page:** `maxDiffPixels` and `stylePath` (CSS masking of dynamic elements) are documented; `maxDiffPixelRatio`/`threshold` are referenced by [D] and prior docs but were **NOT shown on the fetched page — confirm against the installed version** when configuring. OSS (free, in Playwright). [playwright.dev/docs/test-snapshots](https://playwright.dev/docs/test-snapshots). Maturity: **production**. Vitalis fit **HIGH → F5**. Complexity: low.

**Recommended practice:** the QA/Visual phase must emit a **structured PASS/FAIL + screenshots** (see §7 for the side-by-side against the standard). A "tests pass" signal alone is rejected as evidence of done. [VITALIS-BUILD-PROTOCOL.md §8/§9; AGENT-PROMPT-PREAMBLE rule 5.]

**Already exists in Vitalis vs New.**
- *Already exists (REUSE):* the doctrine that *requires* visual proof (§8/§9) and the manual process gate; the React app to render.
- *New (low-cost; `@playwright/test` already at the `luke-app` root):* a Vitalis-targeted `playwright.config` (pointing at the Vitalis dev server) + baseline screenshots + a route-level visual test that renders the protocol document and dashboard.

**Closes:** F5 (fake test confidence) — the highest-leverage net-new capability.

---

## 7. Screenshot comparison

**What it is.** The specific check that compares a freshly rendered protocol document against the *established standard* — the Eric PDF / LIVE peptide dossier — when rebuilding a known standard, so softened wording, missing compounds, or changed dosing are caught visually before merge. This is the "side-by-side comparison against the old standard" the doctrine §8 calls for, made repeatable.

**Recommended tools:**

- **Playwright `toHaveScreenshot` baselines** (production, ADOPT NOW) — commit one baseline per indication×tier; a diff against the rendered output is the comparison. [playwright.dev/docs/test-snapshots](https://playwright.dev/docs/test-snapshots). Vitalis fit **HIGH → F5**.
- **Golden-file / snapshot drift gates** (established practice, ADOPT NOW) — one snapshot per indication×tier for `protocol-core` generators catches softened wording (F4), missing compounds, and changed dosing; **updating a snapshot requires explicit human approval** (a snapshot update is a human-reviewed drift event). [Jest snapshot docs](https://jestjs.io/docs/snapshot-testing) (established). Note: implement the *pattern* in the existing plain-node/Playwright harness — Vitalis has **no Jest**, so do not pull jest-image-snapshot. Closes F4, F5.
- **Argos CI** (production, **ADOPT LATER**, optional layer) — hosted diff-review UI + GitHub PR status check on top of Playwright screenshots; no committed baselines; cheaper / more JS-native than Chromatic/Percy. [github.com/argos-ci/argos](https://github.com/argos-ci/argos). Vitalis fit **HIGH (optional) → F5**. Adopt once Playwright screenshots exist and you want visual pass/fail as a first-class PR gate.

**AVOID-OVERKILL (Consolidation Discipline):** BackstopJS (adds a 2nd browser-automation stack alongside Playwright), Chromatic / Storybook Visual Tests (Vitalis has **no Storybook**), Percy / Applitools (hosted, heavier), jest-image-snapshot (no Jest). All **LOW fit → F5/F3**. [Chromatic](https://www.chromatic.com/pricing) **(vendor claim)**, [Percy](https://www.browserstack.com/docs/percy/overview/plans-and-billing), [Applitools](https://applitools.com/platform/eyes/) **(vendor claim)**, [Storybook VT](https://storybook.js.org/docs/writing-tests/visual-testing), [BackstopJS](https://github.com/garris/BackstopJS), [reg-suit](https://github.com/reg-viz/reg-suit) (needs S3/GCS; MEDIUM, possibly over-engineered for current scale).

**Already exists in Vitalis vs New.**
- *Already exists (REUSE):* the Eric PDF / LIVE dossier as the documented "north star" (`DEVELOPER-HANDOFF.md §3`); the doctrine requiring side-by-side comparison.
- *New:* committed baselines per indication×tier; the comparison test; (later) Argos CI PR gate.

**Closes:** F5 (and F4 by catching softened wording visually).

---

## 8. Structured output validation

**What it is.** Forcing every agent-generated protocol object — and the Start Gate brief itself — to conform to a declared schema, so an *invented structure* (F3) or a *missing/softened field* (F4) becomes a hard error instead of plausible prose. Two layers: validate the model's output at generation time, and validate objects again in the deterministic guard.

**Recommended tools (production-ready, JS-native, ADOPT NOW):**

- **Anthropic Structured Outputs (`output_config.format`)** — grammar-constrained JSON-schema enforcement in the Claude API. **Verified GA on `claude-opus-4-8` with no beta header required** (the field moved from `output_format` to `output_config.format`; old beta header `structured-outputs-2025-11-13` still works during transition). Zero new deps — Vitalis already calls Claude. Claude API token price (no extra). [platform.claude.com/docs/.../structured-outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs). Maturity: **production**. Vitalis fit **HIGH → F1/F6**. Complexity: low. *Lowest-friction path; prefer this over a provider-abstraction wrapper while Vitalis is Claude-only.*
- **Zod v4 (runtime guard)** — validate every agent-generated protocol object against canonical-engine-shaped schemas; a mismatch = invented structure (F3), a missing field = softened output (F4). **Limitation: validates structure, not clinical values from memory — pair with a source lookup for F6.** MIT, ESM+CJS, v4.4.3. [github.com/colinhacks/zod](https://github.com/colinhacks/zod). Maturity: **production**. Vitalis fit **HIGH → F3/F4/F5**. Complexity: low.
- **Machine-checkable Start Gate** (new artifact) — make the §2 Start Gate a Zod-validated structured object with required non-empty / UNKNOWN-flagged fields (CANONICAL SOURCES, LEGACY/PRIOR STANDARD READ, CURRENT IMPL FILES, WHAT MUST BE REUSED / NOT REBUILT). Work is blocked while any field is UNKNOWN. Closes F1, F6.

**ADOPT LATER / situational:**
- **Vercel AI SDK `Output.object()`** — constrains LLM output to a Zod schema if Vitalis ever wants provider abstraction. ⚠️ **Corrected:** `generateObject` is **replaced by `Output.object()` + `generateText` in AI SDK 6** (verified; scout's `generateObject`/`streamObject` naming is stale — pin to the AI SDK 6 `Output` API if adopted). Apache 2.0. [ai-sdk.dev/docs/.../generate-object](https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-object). Maturity: **production**. Vitalis fit **MEDIUM → F1/F6**. (Native `output_config` is simpler while Claude-only.)
- **BAML (BoundaryML)** — typed inter-subagent contracts with Schema-Aligned Parsing, but adds a DSL + build step. Apache 2.0. [github.com/BoundaryML/baml](https://github.com/BoundaryML/baml). Maturity: **production**. Vitalis fit **MEDIUM → F1/F5/F7**.

**AVOID-OVERKILL / wrong stack:** **Instructor JS** (last release Jan 2025, >1yr stale; Anthropic via adapter only — prefer native `output_config`); **Guidance / llguidance / Outlines / XGrammar / jsonformer** (run *inside* inference servers — Vitalis calls hosted APIs, so infrastructure context only, not adoptable). [Instructor JS](https://github.com/567-labs/instructor-js); [guidance](https://github.com/guidance-ai/guidance), [llguidance](https://github.com/guidance-ai/llguidance), [outlines](https://github.com/dottxt-ai/outlines), [xgrammar](https://github.com/mlc-ai/xgrammar).

**Already exists in Vitalis vs New.**
- *Already exists (REUSE):* `check-catalog-guard.cjs` (currently does ad-hoc string checks).
- *New:* `output_config.format` on the generation call; the Zod canonical schemas; Ajv-standalone inside the guard (see §2); the Zod-validated Start Gate artifact.

**Closes:** F3, F4, F6 (and F1 via the validated Start Gate).

---

## 9. Agent handoff logs

**What it is.** A forensic record of what each agent/subagent *intended* and *actually did* — which phase ran, which tools were called in what order, and whether the canonical engine was invoked — so a skipped phase or a bypassed engine is detectable rather than silently tolerated. This is the observability backbone for F2 (solo-patching), F5 (corrupt success), and F7 (inconsistent delegation).

**Recommended practices (plain-Node, ADOPT NOW — no new infra):**

- **Write-ahead intent log** — append a structured intent entry immediately *before* each canonical tool call, update it with the result; the acceptance suite asserts the intent log contains a `blendScheduleFor()` entry on every generation run — if absent, the agent bypassed the engine. Distinguishes "intended" from "actually called." [LogAct, arXiv 2604.07988](https://arxiv.org/html/2604.07988v1) (2026-04-09, **preprint, Meta**, experimental). Closes F5, F6, F3.
- **TRAIL-style granular trace logging** — middleware wrapping tool calls records tools called, order, returns, and "canonical-engine invoked?"; a lightweight deterministic validator confirms correct delegation. Planning/coordination are the highest-impact failure classes. [Patronus TRAIL, arXiv 2505.08638](https://arxiv.org/abs/2505.08638) (2025-05-13, **preprint**, experimental). Closes F7, F2, F5.
- **Trust-skepticism** — treat subagent output as *tool output*, not operator instruction: the orchestrator re-runs `check-catalog-guard.cjs` against a subagent's returned dosing values and does NOT skip validation because the source is "our own" subagent (2025 AI Agent Index: 100% inter-agent trust-exploit susceptibility). [Anthropic, how-we-contain-Claude](https://www.anthropic.com/engineering/how-we-contain-claude) (2026-05-25, established). Closes F5, F6.
- **Inherited goal-drift defense** — a reviewer/QA agent receives a *clean* task spec + canonical files; the first agent's draft is presented as **data to validate**, not the context it reasons from, so a drifted draft can't "infect" the reviewer (the DRAFT→APPROVED human gate partially enforces this). [Menon et al., arXiv 2603.03258](https://arxiv.org/abs/2603.03258) (2026-03-03, **preprint**, experimental). Closes F1, F6, F7.

**ADOPT LATER (richer runtime observability):**
- **Langfuse** (self-host: tracing + prompt **versioning** + LLM-as-judge) — makes "which prompt did the agent use" auditable; self-host keeps protocol data local. MIT; verified v3.178 (Jun 2026; acquired by ClickHouse May 2026). [github.com/langfuse/langfuse](https://github.com/langfuse/langfuse). Maturity: **production**. Vitalis fit **HIGH (LATER) → F6/F1**. **Prefer Langfuse over Agenta/PromptLayer** for the prompt registry (Agenta overlaps → consolidation risk; PromptLayer's JS SDK is **UNKNOWN/unconfirmed**, Python-primary).
- **OpenLLMetry-js + OTel GenAI conventions** — backend-agnostic spans recording which dosing fn fired; ⚠️ **import-order gotcha — the SDK must load before the LLM module.** Apache 2.0; verified v0.27 (May 2026). [github.com/traceloop/openllmetry-js](https://github.com/traceloop/openllmetry-js) + [OTel GenAI conventions](https://opentelemetry.io/blog/2026/genai-observability/) (attrs still experimental). Maturity: **production / emerging**. Vitalis fit **HIGH (LATER) → F3/F7**.
- **Pydantic Logfire (logfire-js)** — SQL-queryable spans ("did any agent call a dosing fn other than the canonical two this week?"); runtime extension of the `check-catalog-guard.cjs` pattern; **API pre-1.0.** MIT, freemium. [github.com/pydantic/logfire-js](https://github.com/pydantic/logfire-js). Maturity: **emerging**. Vitalis fit **MEDIUM → F3/F6**.

**AVOID-OVERKILL / wrong stack:** **OpenLIT** (TS SDK native OTel, but **CJS interop UNKNOWN — confirm `require()` in the `.cjs` server before committing**); Arize Phoenix (needs a Python sidecar server; ELv2 not OSI); Honeycomb Agent Observability (Timeline **Early Access**, not GA — **vendor claim**, don't make it a critical dependency); Datadog LLM Observability (cost-prohibitive greenfield); W&B Weave (ML-training lineage, weak fit). [OpenLIT](https://github.com/openlit/openlit), [Phoenix](https://github.com/Arize-ai/phoenix), [Honeycomb](https://www.honeycomb.io/blog/honeycomb-launches-agent-observability-full-visibility-agentic-workflows) **(vendor claim)**, [Datadog](https://docs.datadoghq.com/llm_observability/), [Weave](https://github.com/wandb/weave).

**Already exists in Vitalis vs New.**
- *Already exists (REUSE):* the four-phase pipeline definition (§3) and the guard/suite as oracles to re-run against subagent output.
- *New:* the write-ahead intent log + middleware trace logging (plain Node); (later) Langfuse / OpenLLMetry-js spans.

**Closes:** F2, F5, F7 (and F3/F6 via the intent log).

---

## 10. Drift incident log

**What it is.** A durable record + alert for when a generation fails, retries are exhausted, or a drift trigger fires — so a client never silently gets no protocol and no notification, and so repeated same-class patches escalate instead of continuing. The doctrine already defines the human-readable drift memo (§4 `DRIFT DETECTED:` template); this component makes it operational.

**Recommended practices (plain-Node + the existing Telegram bot, ADOPT NOW):**

- **Retry-exhaustion DLQ with human-review escalation** — on retry exhaustion, persist the failed generation (client/indication/tier) to a `failed_generations` table, alert via the existing Telegram bot, and expose a reprocess endpoint — killing silent failure. Plain Node + one new table. [LittleHorse retries/DLQ](https://littlehorse.io/blog/retries-and-dlq) (2024-12-13, established). Closes F5, F7.
- **Drift-trigger hard-stop → memo** — the §4 doctrine rule "patches the same class of issue more than twice" becomes a counter that hard-stops into a `DRIFT DETECTED` memo on the 3rd same-class patch, rather than continuing. [VITALIS-BUILD-PROTOCOL.md §4.] Closes F2.
- **Procedure-aware "corrupt success" entries** — when `invocation_count == 0` on a generation that otherwise passed, log it as a drift incident (right output, wrong procedure). [Cao et al., arXiv 2603.03116](https://arxiv.org/abs/2603.03116) (2026-03-03, **preprint**, experimental). Closes F3, F5.

**Already exists in Vitalis vs New.**
- *Already exists (REUSE):* the Telegram bot (`@NehemiahMarcBot` → chat 8617287533) as the operator notification channel; the §4 drift-memo template.
- *New:* the `failed_generations` table + reprocess endpoint; the same-class-patch counter; the corrupt-success log rule.

**Closes:** F2, F3, F5, F7.

---

## 11. CI / build / test gates

**What it is.** The always-on deterministic checks that run on every build and every agent PR — the layer that actually *enforces* everything above, because it runs in code the agent cannot edit. Vitalis already has the spine: the `prebuild` hook → `check-catalog-guard.cjs`, and `npm test` → `node test/acceptance.js` (75/75, RD1–RD4, N3). The architecture extends these and adds three source-of-truth hygiene gates.

**Recommended tools (all production-ready, JS-native, ADOPT NOW):**

- **Changesets** — every change to `protocol-core` requires a human-written changeset file declaring a semver bump + rationale → blocks silent agent bumps; an anti-solo-patch paper trail. Vitalis already has a `packages/protocol-core` monorepo; changeset-bot blocks PRs lacking a declared reason. Verified MIT, npm/yarn/pnpm workspaces. [github.com/changesets/changesets](https://github.com/changesets/changesets). Maturity: **production**. Vitalis fit **HIGH → F1/F2**. Complexity: low.
- **Spectral** — lints ANY JSON/YAML against a custom ruleset ("every compound has `evidence_tier`", "no CJC+Tesa together") in CI; Node CLI + library; pairs with Ajv on catalog JSON + agent output artifacts. Verified v6.15 (Apr 2025), Apache 2.0. [github.com/stoplightio/spectral](https://github.com/stoplightio/spectral). Maturity: **production**. Vitalis fit **HIGH → F1/F4**. Complexity: medium.
- **Knip** (also §2) — CI step catching orphaned parallel dosing files. ISC, v6. [knip.dev](https://knip.dev/). Vitalis fit **HIGH → F3**.
- **Ajv-standalone** (also §2/§8) inside the prebuild guard. MIT, v8.20.0. [github.com/ajv-validator/ajv](https://github.com/ajv-validator/ajv).
- **promptfoo** (also §5) wired as a **blocking** CI gate on agent PRs via `--fail-on-error`. MIT, v0.121.14. [github.com/promptfoo/promptfoo](https://github.com/promptfoo/promptfoo).

**Recommended practices:**
- **Framework-level guardrails LLMs cannot bypass** — Node middleware that cancels any file-write to `protocol-core`, returns BLOCKED on any call bypassing `blendScheduleFor`, and requires a human-signed token to set `APPROVED_RESOURCE`. "Prompts are suggestions — framework hooks are enforcement." [AWS/DEV neurosymbolic guardrails](https://dev.to/aws/ai-agent-guardrails-rules-that-llms-cannot-bypass-596d) (2025-03-10, emerging). Closes F2, F3.
- **Spec-as-executable-truth** — add a grep-based forbidden-pattern gate asserting no file outside `protocol-core` defines a dosing schedule; a JSON-Schema check on `BLEND_SCHEDULES` shape; wire the suite as a **blocking** CI gate. [Spec-Driven Development](https://medium.com/@nprasads/spec-driven-development-in-the-age-of-ai-from-specs-as-documents-to-specs-as-executable-truth-9b9e066712b1) (2026-02-04, emerging). Closes F1, F3, F5.

**Already exists in Vitalis vs New.**
- *Already exists (REUSE/EXTEND):* `check-catalog-guard.cjs` prebuild hook (**extend:** Ajv schema validation + grep "no dosing outside protocol-core"); `npm test` → `acceptance.js` (**extend:** promptfoo + pass^k + invocation-count, wired blocking on agent PRs).
- *New:* Changesets gate on `protocol-core`; Spectral ruleset; Knip step; the Express middleware guardrail + human-signed APPROVED_RESOURCE token.

**Closes:** F1, F2, F3, F4, F5.

---

## 12. Human approval gates

**What it is.** The point where a human turns a DRAFT into a client-visible APPROVED_RESOURCE, and the *only* place where content softening for the client audience is legitimate. Vitalis already has the strongest version of this: the server-authoritative DRAFT→APPROVED_RESOURCE gate (`gates.clientProtocolProjection`, `CLIENT_VISIBLE_STATUS='APPROVED_RESOURCE'`, server-side whitelist; acceptance test **N3** confirms the operator sees full citations/patterns while the client view carries a *softened* basis). The architecture keeps this as the enforcement point and strengthens *how* an agent is allowed to reach it.

**Critical content rule (F4):** Section 02 (the selected schedule) must always render exact curated values — selected dose, route/form, frequency/timing, onboarding/titration, maintenance, offboarding/taper, cycle/review, monitoring. Ranges live in the compound-reference section; compliance text is one framing block. **Softening is permitted ONLY in the server-side client projection of an APPROVED resource** (the operator-full / client-softened two-tier), never in the underlying curated schedule. The eval requirement is to FAIL any Section-02 degradation while preserving that one approved boundary.

**Recommended practices:**
- **LangGraph `interrupt()` + thread-checkpointer for server-gated approval** (production tool, **ADOPT LATER**) — the agent's `interrupt()` freezes state to Postgres/SQLite and returns proposed content to the Express endpoint; **only the server resumes**, enforcing the existing server-authoritative gate (thread_id = document ID). Use when agent flows get multi-step. ⚠️ **GOTCHA: JS lags Python; HITL-resume-with-checkpoint had an open JS issue (#1308) — UNKNOWN/verify on the target `@langchain/langgraph` version first.** MIT, Node 18+, v1.x (Jun 2026). [github.com/langchain-ai/langgraphjs](https://github.com/langchain-ai/langgraphjs) + [LangChain interrupt blog](https://www.langchain.com/blog/making-it-easier-to-build-human-in-the-loop-agents-with-interrupt) (2024-12-14, established). Vitalis fit **HIGH (LATER) → F1/F2/F4**.
- **Server-side pre-action authorization gateway** (emerging practice) — any agent call to `blendScheduleFor`/`selectedScheduleFor`/doc-write passes through Express middleware validating against `research-doctrine.js` + the drift gate **before** executing; reject if it would bypass the canonical engine. [arXiv 2603.20953](https://arxiv.org/pdf/2603.20953) (2026-03-24, **preprint, not peer-reviewed**, emerging). Closes F1, F2, F3, F6.
- **Read-only-by-default tool scoping at registration** — each subagent declares only the tools it needs; the dosing-section subagent reads `protocol-core` only; **none** gets write access to `BLEND_SCHEDULES`/`research-doctrine.js`/the approval whitelist. This structurally prevents F3/F1 at the permission layer. [Anthropic safe agents framework](https://www.anthropic.com/news/our-framework-for-developing-safe-and-trustworthy-agents) (2025-08-04, established). Closes F1, F3.
- **Claude Agent SDK enforcement** (the current runtime) — use `allowedTools` scoping (Read+Glob+Grep) to make analysis subagents read-only, plus named subagents with isolated context. ⚠️ **GOTCHA: hooks reportedly DON'T fire for subagent tool calls (issue #34692) — UNKNOWN/verify; combine with the existing `check-catalog-guard.cjs` prebuild gate and the Express whitelist projection, do NOT replace them with PreToolUse hooks.** SDK MIT; v0.3.162 (Jun 3 2026). [code.claude.com/docs/en/agent-sdk/overview](https://code.claude.com/docs/en/agent-sdk/overview) + [subagents docs](https://code.claude.com/docs/en/agent-sdk/subagents). Vitalis fit **HIGH → F1/F2/F3/F6/F7**.

**AVOID-OVERKILL / wrong stack for orchestration:** OpenAI Agents SDK JS (OpenAI-model-tied; Vitalis is Claude-native); AG2/AutoGen (Python-only); Temporal/Inngest durable execution (only once generation regularly exceeds ~5 min — Inngest first, ~80% value at ~20% setup); mem0/Zep/Letta (soft memory, **never** an authority — pair with the hard gates only). [OpenAI Agents JS](https://github.com/openai/openai-agents-js), [AG2](https://github.com/ag2ai/ag2), [Temporal](https://temporal.io/blog/replay-2026-product-announcements) **(vendor claim; TS SDK peripheral per [D])**, [Inngest AgentKit](https://github.com/inngest/agent-kit), [mem0](https://github.com/mem0ai/mem0), [Zep](https://www.getzep.com/product/agent-memory/) **(vendor claim)**, [Letta](https://www.letta.com/blog/agent-memory) **(vendor claim)**.

**Already exists in Vitalis vs New.**
- *Already exists (REUSE/EXTEND):* the server-authoritative DRAFT→APPROVED_RESOURCE gate (`gates.clientProtocolProjection`, N3) — the execution-hallucination catcher and the one legitimate softening boundary. **Extend:** make it the resume-authority for a LangGraph `interrupt()` (later) and require a human-signed token; enforce read-only specialists via the Claude Agent SDK `allowedTools` at the permission layer.
- *New:* the Express pre-action authorization middleware; the human-signed APPROVED_RESOURCE token; (later) `interrupt()` durable pause.

**Closes:** F1, F2, F3, F4, F5 (the approval gate is the convergence point for content fidelity + process proof).

---

## Appendix A — Sequenced adoption (immediate vs long-term)

**ADOPT NOW (zero/low friction, JS-native, directly closes a failure):** Playwright `toHaveScreenshot` *(dependency already at `luke-app` root; the Vitalis harness is the new build — corrects the KB)* → F5 · promptfoo `trajectory:tool-used` → F1/F3/F4/F5 · Zod v4 schemas → F3/F4/F6 · Ajv-standalone in the guard → F1/F3 · Knip → F3 · Changesets → F1/F2 · Spectral → F1/F4 · AGENTS.md/CLAUDE.md standing orders → F1/F3/F6 · Claude Agent SDK read-only `allowedTools` + 4-element spec → F1/F2/F3/F6/F7 · Anthropic `output_config.format` → F1/F6 · pass^k + invocation-count asserts → F5/F3/F1 · write-ahead intent log + DLQ + Telegram → F5/F6/F7.

**ADOPT LATER (real value, more setup or not yet load-bearing):** Argos CI → F5 · Langfuse self-host (tracing + prompt registry) → F1/F6 · OpenLLMetry-js + OTel conventions → F3/F7 · LangGraph.js `interrupt()` + Postgres checkpointer → F1/F2/F4 *(verify issue #1308)* · Patronus Lynx grounding gate → F6/F1 · Inngest AgentKit / Temporal TS (only if generation >~5 min) → F5/F7 · mem0 (soft grounding only) → F6.

**AVOID-OVERKILL / NOT-NOW:** constrained-decoding engines (Guidance/llguidance/Outlines/XGrammar/jsonformer — run inside inference servers) · BackstopJS/Chromatic/Percy/Storybook-VT/jest-image-snapshot (Playwright covers it; no Storybook, no Jest) · NeMo/LLM Guard/Presidio/Llama Guard 3/Pangea/Guardrails AI (Python-or-SaaS; taxonomies don't match dosing-drift) · AG2/Inspect/Ragas/TruLens/Cleanlab/DeepEval-as-primary (Python-only or not-RAG) · OpenAI Agents SDK JS (OpenAI-tied) · Instructor JS (>1yr stale) · Datadog (cost-prohibitive greenfield) · Rebuff (ARCHIVED May 2025) · Galileo "Context Adherence" reliance (metric UNKNOWN in live JS docs).

## Appendix B — Open unknowns to verify before building

1. **Playwright topology** (verified on disk): `@playwright/test ^1.59.1` **is** installed at the outer `luke-app` root with a root config that targets a *separate* app, not Vitalis; the Vitalis subproject has no config/harness/baselines. The dependency is ~free; the Vitalis visual harness (config + baselines) is a low-cost new build. *(Corrects the KB's "already has Playwright [for Vitalis]" framing.)*
2. **Galileo `galileo-js` Context-Adherence metric — UNKNOWN** in live JS docs (only `correctness`/`output_tone` surfaced). Don't build F6 on it.
3. **Claude Agent SDK subagent-hook bypass (issue #34692)** — UNKNOWN on current v0.3.162; verify before designing enforcement around hooks vs the prebuild gate + Express whitelist.
4. **LangGraph.js HITL-resume-with-checkpoint (issue #1308)** — reproduce on the target version before committing `interrupt()`.
5. **OpenLIT CommonJS interop** — confirm `require()` works in the Vitalis `.cjs` server before adoption.
6. **`@openai/guardrails` npm name + maturity (87★/v0.2.x)** — UNKNOWN/unconfirmed; OpenAI-client-shaped anyway (Vitalis is Claude).
7. **PromptLayer JS SDK** — UNKNOWN (Python-primary); default to Langfuse for a prompt registry.
8. **Non-peer-reviewed preprints** (arXiv 2603.20953, 2604.07988, 2603.03258, 2603.03116, 2505.11368, 2505.08638, 2603.10047, 2604.23178) — directional, not settled. Peer-reviewed anchors that DO hold: tau-bench ([arXiv 2406.12045](https://arxiv.org/abs/2406.12045), ICLR) and the position-bias study ([arXiv 2406.07791](https://arxiv.org/abs/2406.07791), AACL-IJCNLP 2025).
9. **Vendor-marketing sources with only peripheral claim support:** Honeycomb Agent Timeline (Early Access, not GA) and Temporal Replay-2026 (TS SDK peripheral) — don't treat either as load-bearing.
10. **Playwright `maxDiffPixelRatio`/`threshold`** — confirmed `maxDiffPixels` + `stylePath` on the live docs page; the ratio/threshold options were NOT shown there — confirm against the installed Playwright version.
