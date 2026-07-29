# Vitalis Anti-Drift Research Report

*Part of the Vitalis anti-drift research sprint · Research lead: Daniel · 2026-06-03 · Research-only — no product code changed.*

---

## Executive summary

Vitalis has already been bitten by AI-agent drift — the build protocol opens by admitting "agents patched important systems from memory, built parallel logic, and made outputs safer-sounding but less useful." This report names those seven failures (F1–F7), maps each to a machine-checkable reliability requirement, and recommends a JS-native toolset that closes them. The headline: **Vitalis already owns three of the four enforcement patterns the industry literature prescribes** (`check-catalog-guard.cjs`, the `research-doctrine.js` + RD1–RD4 tests, and the server-authoritative DRAFT→APPROVED_RESOURCE gate), so this is an **extension job, not a rebuild**. The single biggest *net-new* gap is a repeatable visual-QA harness — the doctrine demands browser proof of "done," but there is **no Vitalis visual-QA harness wired today**, which is exactly where "tests pass = done" drift keeps recurring. The fix is a small, well-understood add (Playwright `toHaveScreenshot`) plus a handful of zero-to-low-cost CI guards. Everything recommended for "now" is Node/JS, runs in the existing `npm test` / `prebuild` pattern, and avoids the Python-only tools that dominate this category but do not fit Vitalis's stack.

**One correction up front (verified on disk, conductor reconciliation 2026-06-03):** `@playwright/test ^1.59.1` **is** already installed at the outer `luke-app` repo root (in `luke-app/package.json` devDependencies, `package-lock.json`, and `node_modules`), and a root `playwright.config.js` exists — **but that config targets a *separate* app** (the LUKE order app: `testDir: ./tests`, `baseURL: http://localhost:3000`, screenshots off), **not** the Vitalis product. The Vitalis subproject (`vitalis-resource-app/`) has **no Playwright config of its own, no `toHaveScreenshot` baselines, and nothing pointing at the Vitalis dev server (:5173)**. So the *dependency* is effectively free, but the **Vitalis visual harness is a genuine (low-cost) new build** — not a reuse of an existing one. This sharpens, not weakens, the #1 recommendation.

---

## 1. What we researched (and how — method, scope, sourcing rules)

**Goal.** Find the tools and practices that would make Vitalis's seven documented agent-failures *mechanically* impossible (or at least loud and blocking), biased toward the existing stack.

**Scope.** Six tool categories plus a governance/doctrine layer: structured-output/schema enforcement, LLM eval & test frameworks, tracing/observability, hallucination/grounding QA, runtime guardrails, CI + visual/screenshot QA, multi-agent orchestration/memory, and source-of-truth release hygiene.

**Stack we biased toward.** Node/JS, React, Vite, Tailwind, Express, `@vitalis/protocol-core`, the existing `research-doctrine.js`, the RD1–RD4 tests, the `check-catalog-guard.cjs` prebuild gate, and the server-side DRAFT→APPROVED_RESOURCE approval gate. The package is `"type": "commonjs"`, so CommonJS support is a hard filter for anything that runs inside the server or the prebuild guard.

**Sourcing rules (enforced).**
- Live web research used to confirm tools — not memory. Every tool and practice below carries a real source link.
- **Production-ready vs experimental are separated**, and **immediate vs later** are separated.
- Vendor-marketing pages are labeled **(vendor claim)**. Anything not verified is labeled **UNKNOWN**.
- Where a date/version was confirmable it is given; where not, it says UNKNOWN.
- Nothing is recommended because it "sounds impressive." Python-only and OpenAI-model-tied tools are demoted on stack-fit grounds even when individually strong.

**What was verified directly against the Vitalis repo for this report:**
- `package.json` — `prebuild` → `node scripts/check-catalog-guard.cjs`; `test` → `node test/acceptance.js`; `"type": "commonjs"`; `@vitalis/protocol-core` is a local file dependency. **No Playwright dependency in the Vitalis subproject's own `package.json`** (`@playwright/test` *is* installed at the outer `luke-app` repo root, but its root `playwright.config.js` targets a separate app, not Vitalis).
- `scripts/check-catalog-guard.cjs` — confirmed it does **regex/string + JSON-property** checks today (`DISCOUNT_RE`, legacy-path patterns), exactly the kind of ad-hoc checking that a declared JSON Schema (Ajv) would upgrade. It does **not** yet assert "no dosing schedule defined outside protocol-core."
- `packages/protocol-core/` — confirmed `data/dosing.js` defines the dosing authorities and that `generator.js` + `document-model.js` consume them (grep-confirmed: they reference, not re-implement, `BLEND_SCHEDULES` / `blendScheduleFor` / `selectedScheduleFor`).
- `docs/VITALIS-BUILD-PROTOCOL.md` and `docs/vitalis-research-doctrine.md` — confirmed verbatim the §1 No-Solo-Patching list, §2 Start Gate fields, §4 Drift Triggers, §5 Section-02 rule, §6 Dosing Ownership, §8 Visual Gate, §9 Done Definition, and RD1–RD4 enforcement.

---

## 2. Why Vitalis needs this (mapped to the real failures F1–F7)

These are not hypothetical risks. Each is documented as **real and recurring** in Vitalis's own doctrine (`VITALIS-BUILD-PROTOCOL.md`, `vitalis-research-doctrine.md`, `DEVELOPER-HANDOFF.md`, `VITALIS-AGENT-PROMPT-PREAMBLE.md`). The founding sentence — *"agents patched important systems from memory, built parallel logic, and made outputs safer-sounding but less useful"* — directly seeds F6, F3, and F4.

| ID | The failure (plain English) | What must become machine-checkable | Anchor doctrine |
|----|------------------------------|-------------------------------------|-----------------|
| **F1** | Agent **ignored the existing standard** and built without anchoring to it | A validated **Start Gate** artifact (named canonical sources, prior standard actually read, current files, explicit REUSE / DO-NOT-REBUILD list). Blocked while any field is UNKNOWN. New silos reuse the LIVE peptide dossier shell. | BUILD-PROTOCOL §2 + §5; HANDOFF §3, §6 |
| **F2** | Agent **solo-patched** instead of routing to read-only specialists | A discovery+routing phase that runs read-only Source-Extraction + Current-System-Map **before** any edit; edits blocked until those outputs exist; a 3rd same-class patch hard-stops into a DRIFT memo. | BUILD-PROTOCOL §1, §3, §4 |
| **F3** | Agent **built a parallel dosing system** instead of reusing the canonical engine | Exactly ONE dosing authority (`BLEND_SCHEDULES` / `selectedScheduleFor` / `blendScheduleFor` in `protocol-core`). Build fails if a 2nd dosing path/duplicated schedule appears outside protocol-core. Discovered parallel path → collapse, not new branch. | research-doctrine §Dosing; HANDOFF §5; BUILD-PROTOCOL §6 |
| **F4** | Agent **softened specifics into vague compliance language** | Section 02 always renders exact curated values; ranges confined to the compound-reference section; compliance text confined to one framing block. Softening allowed **only** in the server-side client projection of an APPROVED resource. | BUILD-PROTOCOL §5, §4; research-doctrine §Dosing + §Honest labels |
| **F5** | Agent **claimed DONE on green tests** while the visual/product standard failed | DONE requires browser-rendered visual proof + green tests + passing build; side-by-side vs the Eric PDF / LIVE dossier when rebuilding a known standard. "Tests pass" alone is rejected. | BUILD-PROTOCOL §8, §9 |
| **F6** | Agent **coded/claimed from memory** instead of reading canonical sources | Every factual/structural claim traceable to a source read **in-session** (file path/line, DOI, registry entry). HIGH-tier claims need explicit confidence/citation; absent a source → emit UNKNOWN/SOURCE_PENDING/NEEDS_REVIEW and stop. | BUILD-PROTOCOL §4, §5; research-doctrine §Honest labels + RD1–RD4; HANDOFF §7 |
| **F7** | Agent **used subagents/tooling inconsistently** (skipped phases, wrong tool) | The four-phase pipeline (Source-Extraction → Current-System-Map → Implementation → QA/Visual) applied in order, each emitting an observable artifact; QA/Visual emits structured PASS/FAIL + screenshots. Enforced by orchestration + always-on guards. | BUILD-PROTOCOL §3, §8, §5; package.json prebuild hook |

**Three themes the seven failures cluster into:**
1. **Source-of-truth integrity** (F1, F3, F6) → a source-of-truth registry/guard + eval enforcement so duplication or unsourced claims fail the build.
2. **Content fidelity vs compliance** (F4) → eval + visual-QA, with softening permitted **only** at the approved client-projection boundary (Vitalis already encodes this two-tier in acceptance test N3).
3. **Process & proof discipline** (F2, F5, F7) → ordered, observable phases plus mandatory browser proof.

**The dominant gap underlying F5/F7:** the automated harness today is the plain-node acceptance suite (`node test/acceptance.js`) plus the `check-catalog-guard.cjs` prebuild guard — **there is no Vitalis visual harness present** (the `@playwright/test` dependency exists at the `luke-app` root but is unwired for Vitalis) — so the doctrine-mandated §8 visual gate is currently a *manual* step. That is the exact surface where "tests pass = done" drift recurs, which is why a repeatable visual-QA harness is the highest-leverage net-new capability.

---

## 3. Top 10 findings

1. **The single highest-leverage net-new capability is a repeatable visual-QA harness — `Playwright toHaveScreenshot`.** It pixel-diffs rendered React pages against committed baselines and exit-1 gates CI. Verified live: the assertion and its `maxDiffPixels` + `stylePath` options exist ([playwright.dev/docs/test-snapshots](https://playwright.dev/docs/test-snapshots)). **Correction to earlier notes:** the `@playwright/test` dependency is already present at the outer `luke-app` root but **unwired for Vitalis** (its root config targets a separate app) — so the *harness* (a Vitalis-targeted config + baselines) is a small justified new build, while the dependency itself is ~free. Right fit because the stack is React/Vite. *(F5)*

2. **`promptfoo`'s `trajectory:tool-used` assertion is the closest off-the-shelf match to Vitalis's worst failure (the parallel dosing engine).** It can mechanically assert the agent invoked the canonical dosing engine, runs in CI, MIT-licensed, OpenAI-acquired but still OSS — verified at v0.121.14, Jun 2 2026 ([github.com/promptfoo/promptfoo](https://github.com/promptfoo/promptfoo)). *(F3, F1)*

3. **Procedural correctness must be tested separately from output correctness — "corrupt success" is real (a study found 27–78% of benchmark passes violate the intended procedure).** Instrument `selectedScheduleFor`/`blendScheduleFor` to log invocation counts and assert `> 0` per generation; this catches F3 *even when the parallel path happens to produce the right answer* ([Procedure-Aware Evaluation, arXiv 2603.03116](https://arxiv.org/abs/2603.03116) — **preprint**). *(F3, F5)*

4. **Enforce read-only specialists at the tool-permission layer, not the prompt — and know that Claude Agent SDK hooks reportedly do NOT fire for subagent tool calls (issue #34692).** The durable enforcement point is the **existing** Express whitelist projection + `check-catalog-guard.cjs` prebuild gate, not PreToolUse hooks ([Claude Agent SDK subagents](https://code.claude.com/docs/en/agent-sdk/subagents)). *(F2, F3, F7)*

5. **Reuse beats rebuild: Vitalis already has 3 of the 4 enforcement primitives the literature prescribes.** `check-catalog-guard.cjs` (spec-as-truth), RD1–RD4 (read-then-cite), and the server-authoritative approval gate (execution-hallucination catcher) are exactly the prescribed patterns. The sprint is **extension, not greenfield**. *(F1, F3, F6)*

6. **Zod v4 + Ajv-standalone turn structural drift into a hard build failure with no architecture change.** Express the `BLEND_SCHEDULES` shape + approval whitelist as one schema; any agent-added field that doesn't conform fails the build. Both ship CommonJS for the `.cjs` server gate — verified ([Zod v4.4.3, May 2026](https://github.com/colinhacks/zod); [Ajv v8.20.0, Apr 2026, standalone + CJS confirmed](https://github.com/ajv-validator/ajv)). *(F3, F4, F6)*

7. **Knip + Changesets close the two "silent" source-of-truth leaks.** Knip surfaces orphaned parallel-dosing files nothing imports (F3); Changesets blocks an agent silently bumping `protocol-core` without a human-declared rationale (F1/F2). Both zero-cost and monorepo-native ([knip.dev](https://knip.dev/); [changesets](https://github.com/changesets/changesets)). *(F3, F1, F2)*

8. **Softening is legitimate ONLY at the server-side approved client projection — never in the curated schedule.** Acceptance test N3 already encodes the operator-full / client-softened two-tier; the F4 eval requirement is to FAIL any Section-02 degradation while preserving that one approved boundary. *(F4)*

9. **Single-pass green is not evidence of reliability — adopt pass^k.** tau-bench (peer-reviewed, ICLR) shows even strong models fall well below 25% on pass^8 for rule-following tasks; run dosing/compound tests 5+ times and require consistent pass ([tau-bench, arXiv 2406.12045](https://arxiv.org/abs/2406.12045)). *(F5, F1)*

10. **Most of the "impressive" tools in this category are Python-only or OpenAI-tied and are the wrong stack for Vitalis.** Guidance, NeMo Guardrails, Ragas, Inspect, DeepEval, TruLens, and the constrained-decoding engines (Outlines/XGrammar/llguidance) are Python-first; OpenAI Agents SDK is model-tied. The JS-native set (promptfoo, Zod, Ajv, Knip, Changesets, Spectral, Playwright, Claude/LangGraph SDKs) covers all seven failures with no Python process boundary, honoring Operational Simplicity. *(F7)*

---

## 4. Best tools discovered

Maturity, fit, and complexity ratings are carried over from Daniel's verified catalog. **(vendor claim)** = marketing source. **UNKNOWN** = not verified. Fit is rated to the Node/JS + React + Express + protocol-core stack and to reusing existing enforcement.

### 4A. Structured output & schema enforcement (→ F1, F3, F4, F5, F6)

| Tool | What it solves | Maturity | License | Source | Fit → F# | Complexity |
|------|----------------|----------|---------|--------|----------|-----------|
| **Zod v4** | Single source of truth for TS types + runtime validation (`z.infer`); `safeParse()` rejects off-schema output; v4 adds JSON Schema export. Verified v4.4.3 (May 2026), MIT, JSON-Schema conversion + `safeParse` confirmed. | production | MIT | [github.com/colinhacks/zod](https://github.com/colinhacks/zod) | **HIGH** → F3/F6: wrap `BLEND_SCHEDULES` + approval whitelist as the canonical schema every agent must satisfy | low |
| **Anthropic Structured Outputs** (`output_config.format`) | Grammar-constrained JSON-schema enforcement in the Claude API; **GA on Opus 4.8 (verified)**, no beta header, zero new deps; also offers strict tool use. | production | Claude API token price (no extra) | [platform.claude.com/.../structured-outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) | **HIGH** → F1/F6: lowest-friction path; Vitalis already calls Claude | low |
| **Ajv (standalone)** | Fastest JSON-Schema validator; **CommonJS `require()` confirmed**; **standalone mode compiles schemas to pure-JS functions** shippable inside the prebuild gate; drafts 04→2020-12. Verified v8.20.0 (Apr 2026). | production | MIT | [github.com/ajv-validator/ajv](https://github.com/ajv-validator/ajv) | **HIGH** → F1/F3: lets `check-catalog-guard.cjs` validate compound/protocol objects against a declared schema instead of ad-hoc strings | low |
| **Vercel AI SDK — `Output.object()`** ⚠️corrected | Constrains LLM output to a Zod schema. **`generateObject` is REPLACED by `Output.object()` + `generateText` in AI SDK 6** (verified — scout naming was stale). | production | Apache 2.0 | [ai-sdk.dev/docs/.../generate-object](https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-object) | **MEDIUM** → F1/F6: only if a provider-abstraction wrapper is wanted; native `output_config` is simpler if staying Claude-only | low |
| **BAML (BoundaryML)** | DSL → typed TS clients; tolerates markdown-wrapped / CoT-prefixed JSON that breaks `JSON.parse`. | production | Apache 2.0 | [github.com/BoundaryML/baml](https://github.com/BoundaryML/baml) | **MEDIUM** → F1/F5/F7: typed inter-subagent contracts, but adds a DSL + build step | medium |
| **Instructor JS** | Zod-validated extraction w/ retry-on-schema-fail. | production | MIT | [github.com/567-labs/instructor-js](https://github.com/567-labs/instructor-js) | **LOW** → F5: **CAUTION — last release Jan 2025 (>1yr stale)**; Anthropic via adapter only. Prefer native `output_config` | low |
| Guidance / llguidance / Outlines / XGrammar / jsonformer | Token-level constrained decoding **inside inference servers**. | production (jsonformer: experimental) | OSS | [guidance](https://github.com/guidance-ai/guidance), [llguidance](https://github.com/guidance-ai/llguidance), [outlines](https://github.com/dottxt-ai/outlines), [xgrammar](https://github.com/mlc-ai/xgrammar) | **LOW (AVOID-OVERKILL)** — Vitalis calls hosted APIs; these run inside OpenAI/vLLM servers. Infrastructure context only | high |

### 4B. LLM evaluation & test frameworks (→ F1, F3, F4, F5)

| Tool | What it solves | Maturity | License | Source | Fit → F# | Complexity |
|------|----------------|----------|---------|--------|----------|-----------|
| **promptfoo** | Declarative YAML/JS eval + red-team with CI gate; **`trajectory:tool-used` / tool-sequence** + agent-rubric/llm-rubric graders; `--fail-on-error` exits non-zero. **MIT, OpenAI-acquired but still OSS, v0.121.14 Jun 2 2026 — verified.** *(Repo landing page confirms MIT/OSS/version; the specific `trajectory:tool-used` assertion type and the "350k+ developers / used by Anthropic" figures were not reproducible on the landing page itself — carried from Daniel's KB, see Open Unknowns.)* | production | MIT | [github.com/promptfoo/promptfoo](https://github.com/promptfoo/promptfoo) | **HIGH** → F1/F3/F4/F5: asserts the agent called the canonical engine; slots into `node test/acceptance.js` | low |
| **Langfuse** | OTel-compatible tracing + prompt **versioning** + LLM-as-judge; self-host via Docker. | production | MIT (cloud Hobby free) | [github.com/langfuse/langfuse](https://github.com/langfuse/langfuse) | **HIGH (LATER)** → F6/F1: prompt-version pinning makes "which prompt did the agent use" auditable; self-host keeps protocol data local | medium |
| **DeepEval** | Pytest-style; 50+ metrics incl. tool-correctness, task-completion, G-Eval. | production | Apache 2.0 | [github.com/confident-ai/deepeval](https://github.com/confident-ai/deepeval) | **MEDIUM** → F4/F7: strong metrics but **Python-primary** — needs a Python CI job for a Node stack | medium |
| **LangSmith** | Vitest/Jest eval integration; trace persistence. | production | freemium | [docs.langchain.com/langsmith/vitest-jest](https://docs.langchain.com/langsmith/vitest-jest) | **MEDIUM** → F5/F6: **hosted-only — protocol trace data leaves the stack**; no trajectory assertions | medium |
| **Mastra `@mastra/evals`** | TS-native scorers (answer-relevancy, custom model-graded). | emerging | Apache 2.0 | [mastra.ai/docs/evals/overview](https://mastra.ai/docs/evals/overview) | **MEDIUM** → F5/F4: TS-native but scorers couple to Mastra's agent abstraction; verify standalone import | medium |
| **Braintrust** | Hosted evals + quality-gate CI + prompt versioning. | production | freemium; Pro $249/mo **(vendor claim)** | [braintrust.dev](https://www.braintrust.dev/) | **MEDIUM** → F3/F5: hosted SaaS; "Loop" auto-prompt-improvement conflicts with operator-decides governance | medium |
| **Patronus Percival** | Auto-classifies agent-trace failure modes. | emerging | paid API **(vendor claim; [D]: it is a trace debugger, not a general evaluator)** | [patronus.ai/percival](https://www.patronus.ai/percival) | **LOW** → F7: no JS SDK; Python-framework integrations only | medium |
| **Inspect (UK AISI)** | Frontier-safety benchmark evals. | production | MIT | [github.com/UKGovernmentBEIS/inspect_ai](https://github.com/UKGovernmentBEIS/inspect_ai) | **LOW** → F7: safety-benchmark, **Python only**, not product-regression | high |
| **Ragas** | RAG faithfulness/context metrics. | production | Apache 2.0 | [github.com/explodinggradients/ragas](https://github.com/explodinggradients/ragas) | **LOW** → F4: Vitalis is not a RAG pipeline today; **Python only** | medium |

### 4C. Tracing & observability (→ F1, F2, F3, F6, F7)

| Tool | What it solves | Maturity | License | Source | Fit → F# | Complexity |
|------|----------------|----------|---------|--------|----------|-----------|
| **OpenTelemetry GenAI Semantic Conventions** | Shared `gen_ai.*` attribute vocabulary so backends are swappable. | emerging (attrs experimental) | OSS (CNCF) | [opentelemetry.io/blog/2026/genai-observability](https://opentelemetry.io/blog/2026/genai-observability/) | **HIGH (standard, not a tool)** → F3/F6/F7: emit a span per run recording which dosing fn fired; alert on rogue paths | medium |
| **OpenLLMetry / Traceloop (openllmetry-js)** | Drop-in OTel auto-instrumentation for Node LLM calls; `withWorkflow()` wraps canonical-engine calls. | production | Apache 2.0 | [github.com/traceloop/openllmetry-js](https://github.com/traceloop/openllmetry-js) | **HIGH (LATER)** → F3/F7: **import-order gotcha — SDK must load before the LLM module**; pairs with Langfuse | low |
| **OpenLIT** | One-line OTel-native instrumentation + built-in eval types. TS SDK is native OTel; OTel-JS itself assumes CJS compilation, so CJS is workable. | production | Apache 2.0 | [github.com/openlit/openlit](https://github.com/openlit/openlit) | **MEDIUM** → F1/F3/F4/F6: **confirm CJS interop before committing** | low |
| **Pydantic Logfire (logfire-js)** | OTel tracing with **SQL-queryable spans** ("did any agent call a dosing fn other than the canonical two this week?"). | emerging (pre-1.0) | freemium (MIT) | [github.com/pydantic/logfire-js](https://github.com/pydantic/logfire-js) | **MEDIUM** → F3/F6: SQL-over-spans extends the `check-catalog-guard.cjs` pattern at runtime; API pre-1.0 | low |
| **Arize Phoenix** | OTel tracing + FaithfulnessEvaluator; self-host. | production | **ELv2 — not OSI** | [github.com/Arize-ai/phoenix](https://github.com/Arize-ai/phoenix) | **MEDIUM** → F5/F6: requires a **Python sidecar server**; JS eval pkgs alpha | medium |
| **Honeycomb Agent Observability** | Agent Timeline renders the delegation chain. | production (Timeline Early Access) | freemium **(vendor claim)** | [honeycomb.io/blog/...agent-observability](https://www.honeycomb.io/blog/honeycomb-launches-agent-observability-full-visibility-agentic-workflows) | **MEDIUM** → F2/F7: Timeline still Early Access — don't make it a critical dependency yet | medium |
| **Datadog LLM Observability** | Auto-traces Node LLM calls; anomaly detection. | production | paid (no real free tier) | [docs.datadoghq.com/llm_observability](https://docs.datadoghq.com/llm_observability/) | **LOW** → F5/F7: only if DD is already in the stack; cost-prohibitive greenfield | medium |
| **W&B Weave** | LLM tracing + experiment lineage. | emerging | freemium | [github.com/wandb/weave](https://github.com/wandb/weave) | **LOW** → F5/F7: ML-training lineage, weak fit for doc-gen | medium |

### 4D. Hallucination detection & grounding QA (→ F1, F4, F5, F6)

| Tool | What it solves | Maturity | License | Source | Fit → F# | Complexity |
|------|----------------|----------|---------|--------|----------|-----------|
| **Patronus Lynx** | 8B/70B RAG-hallucination model; binary pass/fail vs context; official TS SDK + REST; 8B open-weights for self-host. | production | freemium | [docs.patronus.ai/.../Lynx/base](https://docs.patronus.ai/docs/research_and_differentiators/Lynx/base) | **HIGH (LATER)** → F6/F1: post-generation gate before DRAFT→APPROVED, scoring protocol text against `research-doctrine.js` content as context | low |
| **Galileo (galileo-js)** | Grounding scores. **JS-native confirmed (Apache-2.0, v2.2.0, May 26 2026).** BUT ⚠️ **the Context Adherence metric in the JS SDK is NOT confirmed in live docs — only `correctness`/`output_tone` surfaced. Verified UNKNOWN.** | production (SDK) | Apache 2.0 (freemium) | [github.com/rungalileo/galileo-js](https://github.com/rungalileo/galileo-js) | **MEDIUM** → F6/F1: promising JS-native option, but the specific grounding metric needs verification before relying on it | low |
| **Vectara HHEM-2.1-Open** | 0.1B CPU-runnable grounding score; self-host zero-variable-cost batch. | production | Apache 2.0 | [huggingface.co/vectara/hallucination_evaluation_model](https://huggingface.co/vectara/hallucination_evaluation_model) | **MEDIUM** → F6: cheap nightly batch over APPROVED docs, but **needs a Python wrapper** | medium |
| **TruLens** | RAG Triad (context relevance / groundedness / answer relevance). | production | OSS (Snowflake) | [trulens.org/.../rag_triad](https://www.trulens.org/getting_started/core_concepts/rag_triad/) | **MEDIUM** → F6/F3: offline batch only; **Python** | medium |
| **Cleanlab TLM** | Real-time trustworthiness score per call. | production | freemium **(vendor claim; 3x precision is internal benchmark)** | [help.cleanlab.ai/tlm](https://help.cleanlab.ai/tlm/) | **LOW** → F5/F6: **Python-only** friction | medium |

### 4E. Guardrails & runtime validation (→ F1, F3, F4, F6)

| Tool | What it solves | Maturity | License | Source | Fit → F# | Complexity |
|------|----------------|----------|---------|--------|----------|-----------|
| **Zod (runtime guard)** | Validate every agent-generated protocol object against canonical-engine-shaped schemas; mismatch = invented structure (F3), missing field = softened output (F4). **Limitation: validates structure, not clinical values from memory — pair with a source lookup for F6.** | production | MIT | [github.com/colinhacks/zod](https://github.com/colinhacks/zod) | **HIGH** → F3/F4/F5: most pragmatic runtime guard for the stack | low |
| **`@openai/guardrails` (openai-guardrails-js)** | Drop-in OpenAI-client wrapper: moderation, PII, hallucination-via-vector-store, topic-scope. | emerging | MIT | [github.com/openai/openai-guardrails-js](https://github.com/openai/openai-guardrails-js) | **MEDIUM** → F1/F4/F6: **CAUTION — only ~87★, v0.2.x; OpenAI-client-shaped** (Vitalis is Claude). Package name unconfirmed (see Unknowns) | low |
| **`@presidio-dev/hai-guardrails`** | JS-native injection/PII/secrets/toxicity guards inline (no Python sidecar). | emerging | MIT | [github.com/presidio-oss/hai-guardrails](https://github.com/presidio-oss/hai-guardrails) | **MEDIUM** → F4/F6: **~42★, low adoption**; secrets-guard useful for agent-generated code; complement not primary | low |
| **OpenAI Moderation API** | Free hosted safety classifier; native Node SDK. | production | free | [developers.openai.com/.../moderation](https://developers.openai.com/api/docs/guides/moderation) | **MEDIUM** → F4: blocks harmful content but **does NOT catch compliance over-softening** (general-audience taxonomy) | low |
| **Guardrails AI** | 70+ validators incl. FactualConsistency, Ban-List. | production | Apache 2.0 | [github.com/guardrails-ai/guardrails](https://github.com/guardrails-ai/guardrails) | **MEDIUM** → F1/F3/F4: Ban-List could mirror the forbidden-string gate, but **Python core** conflicts with pure-Node | high |
| **NVIDIA NeMo Guardrails** | Colang dialog/topic policies via Docker REST. | production | Apache 2.0 | [github.com/NVIDIA/NeMo-Guardrails](https://github.com/NVIDIA/NeMo-Guardrails) | **LOW** → F1/F4: new DSL + **Python service**; overkill vs Express | high |
| **LLM Guard / Presidio / Llama Guard 3 / Pangea AI Guard** | PII/injection/safety scanners. | production | OSS / freemium | [LLM Guard](https://protectai.com/llm-guard) **(vendor claim)**, [Presidio](https://github.com/microsoft/presidio), [Llama Guard 3](https://huggingface.co/meta-llama/Llama-Guard-3-8B), [Pangea](https://pangea.cloud/docs/ai-guard/overview) **(vendor claim)** | **LOW** → F4: taxonomies (violence/CSAM/PII) don't match Vitalis's dosing-drift; revisit Presidio only if consumer-facing PHI grows | medium–high |
| **Rebuff** | Prompt-injection detector. | **ARCHIVED May 16 2025 — DO NOT ADOPT** | — | [github.com/protectai/rebuff](https://github.com/protectai/rebuff) | **AVOID** | — |

### 4F. CI guardrails & visual / screenshot QA (→ F3, F5) — *closes the missing §8 gate*

| Tool | What it solves | Maturity | License | Source | Fit → F# | Complexity |
|------|----------------|----------|---------|--------|----------|-----------|
| **Playwright `toHaveScreenshot`** | Pixel-diffs rendered React pages vs committed baselines; exit-1 gates CI. **Verified: assertion + `maxDiffPixels` + `stylePath` masking confirmed live; baselines "should be committed to version control."** `maxDiffPixelRatio`/`threshold` not shown on the page (see Unknowns). **NOTE: `@playwright/test` is already installed at the `luke-app` root but unwired for Vitalis (its config targets a separate app); the new work is a Vitalis-targeted config + baselines — low-cost, not the dependency itself.** | production | OSS (free) | [playwright.dev/docs/test-snapshots](https://playwright.dev/docs/test-snapshots) | **HIGH** → F5: **the single highest-leverage fix for the manual §8 gate** | low |
| **Argos CI** | Hosted diff-review UI + GitHub PR status check on top of Playwright screenshots; no committed baselines. | production | freemium (OSS engine) | [github.com/argos-ci/argos](https://github.com/argos-ci/argos) | **HIGH (optional layer)** → F5: makes visual pass/fail a first-class PR gate; more JS-native than Chromatic/Percy | low |
| **reg-suit** | Framework-agnostic diff + S3/GCS baselines + PR comments; zero SaaS. | production | OSS (free + storage) | [github.com/reg-viz/reg-suit](https://github.com/reg-viz/reg-suit) | **MEDIUM** → F5: needs S3/GCS setup; possibly over-engineered for current scale | medium |
| **BackstopJS** | Self-contained route-level visual regression + Docker. | production | OSS (free) | [github.com/garris/BackstopJS](https://github.com/garris/BackstopJS) | **MEDIUM** → F5: **adds a 2nd browser-automation stack — Consolidation Discipline warns against this once Playwright is in** | medium |
| **Chromatic / Percy / Applitools / Storybook Visual Tests / jest-image-snapshot** | Hosted visual testing / component snapshots. | production | freemium / paid | [Chromatic](https://www.chromatic.com/pricing) **(vendor claim)**, [Percy](https://www.browserstack.com/docs/percy/overview/plans-and-billing), [Applitools](https://applitools.com/platform/eyes/) **(vendor claim)**, [Storybook VT](https://storybook.js.org/docs/writing-tests/visual-testing), [jest-image-snapshot](https://github.com/americanexpress/jest-image-snapshot) | **LOW** → F5/F3: Vitalis has **no Storybook** and **no Jest** — these add parallel tooling. AVOID-OVERKILL now | medium–high |

### 4G. Multi-agent orchestration, memory & durable execution (→ F1, F2, F3, F5, F6, F7)

| Tool | What it solves | Maturity | License | Source | Fit → F# | Complexity |
|------|----------------|----------|---------|--------|----------|-----------|
| **Claude Agent SDK** | The agent loop Vitalis already runs on. PostToolUse/PreToolUse hooks can gate Edit/Write; **`allowedTools` scoping** makes analysis subagents read-only; named subagents with isolated context. | production | SDK MIT (Claude API tokens) | [code.claude.com/docs/en/agent-sdk/overview](https://code.claude.com/docs/en/agent-sdk/overview) | **HIGH** → F1/F2/F3/F6/F7: **already in use**; enforce read-only specialists at the permission layer. **GOTCHA: hooks reportedly DON'T fire for subagent tool calls (issue #34692) — combine with the existing prebuild gate, don't replace it** | low |
| **LangGraph.js** | Graph topology forces agents into lanes; `interrupt()` + Postgres checkpointer = durable approval gate where only the server resumes. | production | MIT | [github.com/langchain-ai/langgraphjs](https://github.com/langchain-ai/langgraphjs) | **HIGH (LATER)** → F1/F2/F4: complements the server-authoritative gate. **GOTCHA: JS lags Python; HITL-resume-with-checkpoint had an open issue (#1308) — verify** | medium |
| **Inngest AgentKit** | TS durable step execution + deterministic Network routing + MCP tools. | emerging | Apache 2.0 (+ cloud) | [github.com/inngest/agent-kit](https://github.com/inngest/agent-kit) | **MEDIUM** → F2/F3/F7: durable steps + deterministic routing; **verify npm version vs marketing** | medium |
| **mem0** | Persistent agent memory; query "current dosing standard" at session start. | production | Apache 2.0 | [github.com/mem0ai/mem0](https://github.com/mem0ai/mem0) | **MEDIUM** → F6: **soft memory layer, NOT a hard gate — pair with `check-catalog-guard.cjs` + RD1–RD4**; risks re-introducing memory-as-truth if treated as authority | low |
| **OpenAI Agents SDK JS** | Handoffs + tool-level guardrails (`needsApproval`). | production | MIT | [github.com/openai/openai-agents-js](https://github.com/openai/openai-agents-js) | **MEDIUM** → F2/F7: **OpenAI-model-tied; Vitalis is Claude-native** — Claude Agent SDK / LangGraph.js fit better | low |
| **Mastra** | Full-stack TS agent framework + workflow suspension. | production | Apache 2.0 | [github.com/mastra-ai/mastra](https://github.com/mastra-ai/mastra) | **MEDIUM** → F1/F3/F7: opinionated full backend may conflict with the existing Express server; evaluate workflow layer only | medium |
| **Temporal (TS SDK)** | Durable execution / saga compensation for long multi-step generation. | production | OSS server (MIT) + Cloud **(vendor claim; [D]: TS SDK mentioned only peripherally on the cited page)** | [temporal.io/blog/replay-2026-product-announcements](https://temporal.io/blog/replay-2026-product-announcements) | **MEDIUM (LATER)** → F5/F7: only if generation regularly exceeds ~5 min; **Inngest gives ~80% of value at ~20% setup** | high |
| **Zep / Letta** | Temporal-knowledge-graph / virtual-memory agent memory. | production | freemium / OSS core **(vendor claim)** | [Zep](https://www.getzep.com/product/agent-memory/), [Letta](https://www.letta.com/blog/agent-memory) | **MEDIUM/LOW** → F6: Zep needs Neo4j (Community Ed deprecated Apr 2025); Letta is agent-runtime-centric. mem0 is lower-friction | high |
| **AG2 (AutoGen fork)** | GroupChat multi-agent. | emerging | Apache 2.0 | [github.com/ag2ai/ag2](https://github.com/ag2ai/ag2) | **LOW (AVOID)** → F2/F7: **Python only** — violates Operational Simplicity; implicit routing harder to reason about than LangGraph | medium |

### 4H. Source-of-truth hygiene & release governance (→ F1, F2, F3)

| Tool | What it solves | Maturity | License | Source | Fit → F# | Complexity |
|------|----------------|----------|---------|--------|----------|-----------|
| **Knip** | Detects unused files/exports/deps — surfaces orphaned **parallel dosing files** an agent created that nothing imports. Verified: unused files/exports/deps + monorepo-aware, ISC. | production | ISC | [knip.dev](https://knip.dev/) | **HIGH** → F3: CI step catches a new dosing file nothing imports; audits `@vitalis/protocol-core` for parallel-reimpl exports | low |
| **Changesets** | Every change to `protocol-core` requires a human-written changeset declaring semver + rationale → blocks silent agent bumps. | production | MIT | [github.com/changesets/changesets](https://github.com/changesets/changesets) | **HIGH** → F1/F2: Vitalis already has the `packages/protocol-core` monorepo; changeset-bot blocks PRs lacking a declared reason | low |
| **Spectral** | Lints ANY JSON/YAML against a custom ruleset ("every compound has `evidence_tier`", "no CJC+Tesa together") in CI. | production | Apache 2.0 | [github.com/stoplightio/spectral](https://github.com/stoplightio/spectral) | **HIGH** → F1/F4: domain-lint on catalog JSON + agent output artifacts; pairs with Ajv | medium |
| **Langfuse / Agenta / PromptLayer (prompt registries)** | Versioned prompt CMS; production label = canonical prompt agents must pull (not memory). | production | MIT / freemium | [Langfuse](https://github.com/langfuse/langfuse), [Agenta](https://github.com/Agenta-AI/agenta), [PromptLayer](https://www.promptlayer.com/) **(vendor claim; [D]: JS SDK unconfirmed)** | **HIGH/MEDIUM (LATER)** → F1/F6: prefer **Langfuse** (JS-first, self-host) over Agenta (overlap) or PromptLayer (JS unverified) | medium |

---

## 5. Best doctrines / practices discovered

These are battle-tested engineering patterns (mostly from Anthropic's own agent guidance) plus newer research. **Preprints are labeled** — treat them as directional, not settled. The two peer-reviewed anchors are tau-bench (ICLR) and the position-bias study (AACL-IJCNLP 2025).

### Production-grade / established patterns

| Practice | Source | What it means for Vitalis | F# |
|----------|--------|----------------------------|-----|
| **Simplicity-first: exhaust single-agent / prompt-chaining before adding agents** | [Anthropic, Building Effective Agents](https://www.anthropic.com/research/building-effective-agents) (2024-12-19) | If the answer is a canonical read of an existing Vitalis file, **use a file-read tool, not an agent**. Spawning an agent for a `BLEND_SCHEDULES` lookup is waste and an F3 vector. | F3, F7 |
| **Orchestrator-workers; 4-element spec per subagent (objective / output format / tools+sources / boundaries)** | [Anthropic multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) (2025-06-13) | Orchestrator calls `selectedScheduleFor` and passes the result as ground-truth to each read-only section subagent. Without the 4-element spec, subagents "duplicate work or leave gaps." | F2, F3 |
| **Canonical-source injection: orchestrator is the single reader of canon, forwards verified payloads** | [Anthropic Managed Agents](https://platform.claude.com/docs/en/managed-agents/multi-agent) (date UNKNOWN) | Orchestrator reads `research-doctrine.js` + the `BLEND_SCHEDULES` entry + `check-catalog-guard.cjs` output **before** spawning subagents; inject as locked ground truth; subagents get read-only tools scoped to their section dir. | F1, F6 |
| **Routing: classify first, then direct to the right specialist** | [Claude Common Workflow Patterns](https://claude.com/blog/common-workflow-patterns-for-ai-agents-and-when-to-use-them) (2026-03-05) | Classify each request into protocol-doc / evidence-synthesis / compliance lanes before invoking any agent — prevents a dosing agent rewriting evidence in vague safety language. | F4, F7 |
| **Evaluator-optimizer ONLY when criteria are machine-verifiable & baseline weak; use deterministic linters otherwise; cap loops** | [Anthropic](https://www.anthropic.com/research/building-effective-agents) (2024-12-19) + [AgentPatterns.ai](https://www.agentpatterns.ai/agent-design/evaluator-optimizer/) (2026-05-27) | Vitalis's deterministic gates (the acceptance suite, `check-catalog-guard.cjs`, RD1–RD4) ARE the correct evaluator. An LLM-evaluator on top creates F5. Use LLM eval only for non-verifiable voice/specificity; **cap at 2 rounds**. | F5 |
| **Minimal-footprint / read-only-by-default tool scoping at registration (not prompt)** | [Anthropic safe agents framework](https://www.anthropic.com/news/our-framework-for-developing-safe-and-trustworthy-agents) (2025-08-04) | Each subagent declares only needed tools: dosing-section subagent = read `protocol-core` only; none gets write to `BLEND_SCHEDULES`/`research-doctrine.js`/approval whitelist. Structurally prevents F3/F1 at the permission layer. | F1, F3 |
| **Trust-skepticism: treat subagent output as tool output, not operator instruction** | [Anthropic, how-we-contain-Claude](https://www.anthropic.com/engineering/how-we-contain-claude) (2026-05-25) | Orchestrator re-runs `check-catalog-guard.cjs` against a subagent's returned dosing values — does NOT skip validation because the source is "our own" subagent. | F5, F6 |
| **When NOT to add agents (under 128K tokens, sequential shared-state, deterministic-tool-exists)** | [niteagent post-mortem](https://niteagent.com/blog/multi-agent-production-2026/) (2026-05-15) | Lookups vs `BLEND_SCHEDULES`, validation vs `check-catalog-guard.cjs`, a test run, a file-read of `research-doctrine.js` are **tool/subprocess calls, NOT agent tasks** (multi-agent uses ~15× tokens). | F3, F7 |
| **LangGraph `interrupt()` + thread-checkpointer for server-gated approval** | [LangChain interrupt blog](https://www.langchain.com/blog/making-it-easier-to-build-human-in-the-loop-agents-with-interrupt) (2024-12-14) | `interrupt()` freezes state to Postgres/SQLite and returns proposed content to the Express endpoint; **only the server resumes**, enforcing the existing server-authoritative gate. thread_id = document ID. | F1, F2, F4 |
| **Retry-exhaustion DLQ with human-review escalation** | [LittleHorse retries/DLQ](https://littlehorse.io/blog/retries-and-dlq) (2024-12-13) | On retry exhaustion, persist the failed generation (client/indication/tier) to a `failed_generations` table, alert via the existing **Telegram bot**, expose a reprocess endpoint — kills silent failures. Plain Node + one table. | F5, F7 |
| **Context-rot mitigation: fixed window + JIT retrieval; don't trust "remembered" canon** | [Chroma context-rot](https://www.trychroma.com/research/context-rot) (2025-07-14) | Dosing-engine output, doctrine assertions, blend schedules must be **JIT-fetched per generation**, never recalled from earlier in a long session. Treat the suite + guard as oracles agents call. | F6 |
| **Sub-agent isolation + structured note-taking + CLAUDE.md/AGENTS.md standing orders** | [Anthropic context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) (2025-09-29) | A root `AGENTS.md`/`CLAUDE.md` declaring: the three dosing functions are the ONLY dosing authorities; `research-doctrine.js` read-only; approval gate server-enforced; forbidden-string list mirroring the guard. **Update after every observed F1/F3/F4/F6.** | F1, F2, F3, F6 |
| **Golden-file / snapshot drift gates (snapshot update = human-reviewed drift event)** | [Jest snapshot docs](https://jestjs.io/docs/snapshot-testing) | One snapshot per indication×tier for `protocol-core` generators catches softened wording (F4), missing compounds, changed dosing before merge. Rendered-doc snapshots feasible via the new Playwright layer. | F4, F5 |
| **pass^k reliability testing (multi-trial consistency, not single-pass)** | [tau-bench, Yao et al., arXiv 2406.12045](https://arxiv.org/abs/2406.12045) (2024-06-17, **ICLR peer-reviewed**) | Run any suite test touching dosing/compound/protocol text **5+ times**, require consistent pass + track variance. A single stochastic pass is not evidence of reliable adherence. | F5, F1 |
| **Spec-as-executable-truth: CI gates enforce schema/spec conformance** | [Spec-Driven Development](https://medium.com/@nprasads/spec-driven-development-in-the-age-of-ai-from-specs-as-documents-to-specs-as-executable-truth-9b9e066712b1) (2026-02-04) | Vitalis already does this. Extend: grep-based forbidden-pattern gate asserting no file outside `protocol-core` defines a dosing schedule; JSON-Schema check on `BLEND_SCHEDULES` shape; wire the suite as a **blocking** CI gate on agent PRs. | F1, F3, F5 |

### Emerging / preprint-grade (directional — verify before building on)

| Practice | Source | What it means for Vitalis | F# |
|----------|--------|----------------------------|-----|
| **Server-side pre-action authorization gateway (intercept tool calls in middleware the agent can't modify)** | [arXiv 2603.20953](https://arxiv.org/pdf/2603.20953) (2026-03-24, **preprint**) | Any agent call to `blendScheduleFor`/`selectedScheduleFor`/doc-write passes through Express middleware validating against `research-doctrine.js` + drift gate **before** executing; reject if it bypasses the canonical engine. Enforce at infra, not prompt. | F1, F2, F3, F6 |
| **Write-ahead intent log (log intent before execute)** | [LogAct, arXiv 2604.07988](https://arxiv.org/html/2604.07988v1) (2026-04-09, **preprint, Meta**) | Append a structured intent entry immediately before each canonical tool call; the suite asserts the intent log contains a `blendScheduleFor()` entry per generation — if absent, the agent bypassed the engine. Distinguishes "intended" from "actually called." | F5, F6, F3 |
| **Procedure-Aware Evaluation: detect "corrupt success" (right output, wrong procedure)** | [Cao et al., arXiv 2603.03116](https://arxiv.org/abs/2603.03116) (2026-03-03, **preprint**) | Instrument the dosing functions to log invocation counts per job; assert `> 0` for every generation. Catches F3 even when the parallel path accidentally produces correct output. (Study: 27–78% of "successes" violate procedure.) | F5, F3, F1 |
| **Subagent permission scoping; hooks DON'T fire for subagent tool calls** | [Claude Agent SDK subagents](https://code.claude.com/docs/en/agent-sdk/subagents) + issue #34692 (2025) | Read-only research subagent = read tools only; do NOT rely on PreToolUse hooks for delegated work. The Express whitelist projection is the correct enforcement point since it already exists. | F2, F6, F7 |
| **Framework-level guardrails LLMs cannot bypass (rules in deterministic code, not prompt)** | [AWS/DEV neurosymbolic guardrails](https://dev.to/aws/ai-agent-guardrails-rules-that-llms-cannot-bypass-596d) (2025-03-10) | Node middleware that cancels any file-write to `protocol-core`, returns BLOCKED on any call bypassing `blendScheduleFor`, and requires a human-signed token to set `APPROVED_RESOURCE`. | F2, F3 |
| **Living spec with protected-decision markers + bidirectional update** | [Augment Code living specs](https://www.augmentcode.com/guides/living-specs-for-ai-agent-development) (2026-03-20) | Add `DECISIONS.json` / `locked:true` markers to `BLEND_SCHEDULES` dosing params with rationale; any agent PR touching a locked entry triggers human review; AGENTS.md points agents to read it first. | F1, F4, F6 |
| **Inherited goal-drift defense: isolate each agent's context from prior agents' trajectories** | [Menon et al., arXiv 2603.03258](https://arxiv.org/abs/2603.03258) (2026-03-03, **preprint**) | A reviewer agent must receive a clean task spec + canonical files — the first agent's draft is presented as **data to validate**, not the context it reasons from. The DRAFT→APPROVED human gate partially enforces this. | F1, F6, F7 |
| **LLM-as-judge bias control: style/verbosity bias dominates — apply length/budget constraints** | [Soumik, arXiv 2604.23178](https://arxiv.org/abs/2604.23178) (2026-04-25, **preprint**) + [Shi et al., arXiv 2406.07791](https://arxiv.org/abs/2406.07791) (**AACL-IJCNLP 2025**) | Any Vitalis LLM-judge must include explicit budget/length constraints and score procedural compliance independently of prose — else a style-biased judge rates verbose hedged text (the F4 failure) as higher quality. | F4, F5 |
| **Domain-guideline prioritization over pretraining defaults (GuideBench)** | [Diao et al., arXiv 2505.11368](https://arxiv.org/abs/2505.11368) (2025-05-16, **preprint**) | Prompts state Vitalis rules **supersede** general medical knowledge; inject relevant `research-doctrine.js` rules inline every call; run `check-catalog-guard.cjs` as inline post-generation validation, not only at build. | F1, F6, F4 |
| **TRAIL: granular agent-trace inspection (planning/coordination are highest-impact failures)** | [Patronus TRAIL, arXiv 2505.08638](https://arxiv.org/abs/2505.08638) (2025-05-13, **preprint**) | Add structured trace logging (tools called, order, returns, canonical-engine invoked?) via middleware; a lightweight validator confirms correct delegation — catches F7/F2. | F7, F2, F5 |
| **Single-task specialist chain + Reconciler (vs one multi-role agent)** | [Freeman et al., arXiv 2603.10047](https://arxiv.org/abs/2603.10047) (2026-03-08, **preprint**) | Decompose the Builder: Compound-Selector (RO) → Schedule-Fetcher (RO, canonical engine only) → Narrative-Writer (write) → Compliance-Checker (RO, vs `research-doctrine.js`); the approval gate plays Reconciler. Also: inject the serialized human-readable schedule object into every prompt, not just the function name. | F1, F2, F3, F6, F7 |

---

## 6. What applies immediately

**Bias: JS-native, reuse existing enforcement (`research-doctrine.js`, RD1–RD4, `check-catalog-guard.cjs`, the approval gate), close the missing visual gate first.** Everything here is zero/low friction, runs in the existing `npm test` / `prebuild` pattern, and directly closes a documented failure.

| # | Item | F# | Why now (one line) | Source |
|---|------|-----|--------------------|--------|
| 1 | **Playwright `toHaveScreenshot`** (config + baselines + side-by-side vs Eric PDF / LIVE dossier) | F5 | Converts the manual §8 visual gate into a CI-blocking one — the highest-leverage net-new capability. **The `@playwright/test` dependency already exists at the `luke-app` root (unwired for Vitalis); the new work is a Vitalis-targeted config + baselines — small and stack-natural.** | [playwright.dev](https://playwright.dev/docs/test-snapshots) |
| 2 | **promptfoo** (`trajectory:tool-used` + agent-rubric, wired into `node test/acceptance.js`) | F1, F3, F4, F5 | MIT, JS-native, npx; trajectory assertion *proves* the agent called the canonical engine; rubric catches softened language. | [promptfoo](https://github.com/promptfoo/promptfoo) |
| 3 | **Zod v4** (canonical schemas for `BLEND_SCHEDULES` + approval whitelist) | F3, F4, F6 | Makes "agent invented its own structure" a hard runtime error; works in Node. | [zod](https://github.com/colinhacks/zod) |
| 4 | **Ajv standalone** (inside `check-catalog-guard.cjs`) | F1, F3 | Upgrades the prebuild guard from string checks to declared JSON-Schema validation; native CJS (verified). | [ajv](https://github.com/ajv-validator/ajv) |
| 5 | **Knip** (CI step) | F3 | Surfaces orphaned parallel dosing files an agent created that nothing imports. | [knip.dev](https://knip.dev/) |
| 6 | **Changesets** (gate on `protocol-core`) | F1, F2 | Already a monorepo; blocks silent agent bumps and forces a human-declared rationale. | [changesets](https://github.com/changesets/changesets) |
| 7 | **Spectral** (ruleset on catalog JSON + agent artifacts) | F1, F4 | Domain-lint ("every compound has `evidence_tier`", "no CJC+Tesa") in CI; pairs with Ajv. | [spectral](https://github.com/stoplightio/spectral) |
| 8 | **AGENTS.md / CLAUDE.md standing-orders file** | F1, F3, F6 | Free; loads canonical constraints + forbidden-string list at session start; update after every observed failure. | [Anthropic context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) |
| 9 | **Claude Agent SDK read-only `allowedTools` scoping + 4-element subagent spec** | F1, F2, F3, F6, F7 | Already the runtime; enforce read-only specialists at the permission layer. (Combine with the prebuild gate — hooks don't fire for subagents.) | [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview) |
| 10 | **Anthropic Structured Outputs** (`output_config.format`) | F1, F6 | GA on Opus 4.8 (verified); zero new deps; forces schema-valid agent output at generation time. | [structured-outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) |
| 11 | **pass^k + procedure-aware invocation-count assertions** in the suite | F5, F3, F1 | Cheap test-harness changes that catch corrupt success and stochastic non-adherence. | [tau-bench](https://arxiv.org/abs/2406.12045), [PAE](https://arxiv.org/abs/2603.03116) |
| 12 | **Write-ahead intent log + DLQ + Telegram escalation** | F5, F6, F7 | Plain Node + one table; distinguishes "intended" vs "actually called" and kills silent failures via the existing bot. | [LogAct](https://arxiv.org/html/2604.07988v1), [LittleHorse DLQ](https://littlehorse.io/blog/retries-and-dlq) |

### Adopt later (real value, but more setup or not yet load-bearing)

| Item | F# | Why later | Source |
|------|-----|-----------|--------|
| **Argos CI** | F5 | First-class PR visual gate once Playwright screenshots exist; cheaper/more JS-native than Chromatic/Percy. | [argos](https://github.com/argos-ci/argos) |
| **Langfuse** (self-host: tracing + prompt registry) | F1, F6 | The observability + prompt-version-pinning layer once runtime drift detection is needed; pick over Agenta/PromptLayer to avoid duplication. | [langfuse](https://github.com/langfuse/langfuse) |
| **OpenLLMetry-js + OTel GenAI conventions** | F3, F7 | Backend-agnostic spans recording which dosing fn fired; mind the import-order gotcha. | [openllmetry-js](https://github.com/traceloop/openllmetry-js), [OTel GenAI](https://opentelemetry.io/blog/2026/genai-observability/) |
| **LangGraph.js `interrupt()` + Postgres checkpointer** | F1, F2, F4 | Durable approval pause complementing the server gate; verify the JS HITL-resume issue (#1308) first. | [langgraphjs](https://github.com/langchain-ai/langgraphjs) |
| **Patronus Lynx** (post-generation grounding gate) | F6, F1 | Scores protocol text against `research-doctrine.js` before DRAFT→APPROVED; cheap at Vitalis volume. | [Lynx](https://docs.patronus.ai/docs/research_and_differentiators/Lynx/base) |
| **Inngest AgentKit / Temporal TS** | F5, F7 | Durable execution only once generation regularly exceeds ~5 min; Inngest first (~80% value, ~20% setup). | [agent-kit](https://github.com/inngest/agent-kit), [Temporal](https://temporal.io/blog/replay-2026-product-announcements) **(vendor claim)** |
| **mem0** | F6 | Soft session-start grounding — only as a complement to the hard gates, never as authority. | [mem0](https://github.com/mem0ai/mem0) |

---

## 7. What is overkill

These are real, often-good tools — but redundant given what Vitalis already has, or aimed at a scale Vitalis is not at. Adopting them now would violate System Consolidation Discipline (don't add a parallel stack when one exists).

| Item | F# | Why it's overkill for Vitalis now | Source |
|------|-----|-----------------------------------|--------|
| **Token-level constrained decoding: Guidance / llguidance / Outlines / XGrammar / jsonformer** | F1, F6 | They run *inside* inference servers (OpenAI/vLLM). Vitalis calls hosted APIs — `output_config.format` already gives schema-constrained output. Infrastructure context, not adoptable. | [guidance](https://github.com/guidance-ai/guidance), [outlines](https://github.com/dottxt-ai/outlines), [xgrammar](https://github.com/mlc-ai/xgrammar) |
| **BackstopJS / Chromatic / Percy / Storybook-VT / jest-image-snapshot** | F5, F3 | Playwright already covers visual diffing once added; Vitalis has **no Storybook and no Jest**, so these add a second browser/test stack. | [BackstopJS](https://github.com/garris/BackstopJS), [Chromatic](https://www.chromatic.com/pricing) **(vendor claim)**, [jest-image-snapshot](https://github.com/americanexpress/jest-image-snapshot) |
| **Temporal (full)** | F5, F7 | Durable execution is justified only past ~5-min multi-step generation; Inngest gives most of the value at a fraction of the setup. | [Temporal](https://temporal.io/blog/replay-2026-product-announcements) **(vendor claim)** |
| **Zep / Letta (heavy memory)** | F6 | Zep needs Neo4j (Community Ed deprecated Apr 2025); Letta is agent-runtime-centric and conflicts with the Claude loop. mem0 is lower-friction if a soft memory layer is wanted at all. | [Zep](https://www.getzep.com/product/agent-memory/) **(vendor claim)**, [Letta](https://www.letta.com/blog/agent-memory) **(vendor claim)** |
| **Braintrust "Loop" / any auto-prompt-improvement** | F3, F5 | Auto-prompt-rewriting conflicts with the operator-decides governance model — Marc decides, the system doesn't self-optimize silently. | [braintrust](https://www.braintrust.dev/) **(vendor claim)** |

---

## 8. What to avoid

Hard "no" for the current Vitalis stack — wrong runtime, abandoned, or mismatched failure taxonomy.

| Item | Reason | Source |
|------|--------|--------|
| **Python-only tools as primary: AG2 (AutoGen), Inspect, Ragas, TruLens, Cleanlab, DeepEval, NeMo Guardrails, Guardrails AI, Vectara HHEM** | Each forces a Python process boundary into a pure-Node stack, violating Operational Simplicity. Several (Ragas, TruLens) also assume a RAG pipeline Vitalis doesn't have today. | [AG2](https://github.com/ag2ai/ag2), [Inspect](https://github.com/UKGovernmentBEIS/inspect_ai), [Ragas](https://github.com/explodinggradients/ragas), [NeMo](https://github.com/NVIDIA/NeMo-Guardrails) |
| **Safety-taxonomy guardrails: LLM Guard / Presidio / Llama Guard 3 / Pangea / OpenAI Moderation (for F4)** | Their categories (violence/CSAM/PII) do **not** match Vitalis's failure, which is compliance *over-softening* of dosing — a moderation classifier will pass the exact text that drift produces. Revisit Presidio only if consumer-facing PHI handling grows. | [Presidio](https://github.com/microsoft/presidio), [Llama Guard 3](https://huggingface.co/meta-llama/Llama-Guard-3-8B), [Moderation](https://developers.openai.com/api/docs/guides/moderation) |
| **OpenAI Agents SDK JS** | OpenAI-model-tied; Vitalis is Claude-native. Claude Agent SDK / LangGraph.js fit the stack. | [openai-agents-js](https://github.com/openai/openai-agents-js) |
| **Instructor JS** | Last release Jan 2025 (>1yr stale) + Anthropic only via adapter; native `output_config` is the lower-risk path. | [instructor-js](https://github.com/567-labs/instructor-js) |
| **Datadog LLM Observability** | Cost-prohibitive greenfield; only worth it if Datadog is already paid for. | [Datadog](https://docs.datadoghq.com/llm_observability/) |
| **Rebuff** | **Archived May 16 2025** — unmaintained, do not adopt. | [rebuff](https://github.com/protectai/rebuff) |
| **Building on Galileo "Context Adherence"** | The JS SDK is real, but the specific grounding metric is **UNVERIFIED in live docs** (only `correctness`/`output_tone` surfaced). Don't build an F6 gate on it until confirmed. | [galileo-js](https://github.com/rungalileo/galileo-js) |
| **`@openai/guardrails` as a primary guard** | Only ~87★/v0.2.x, OpenAI-client-shaped (Vitalis is Claude), and the npm package name is unconfirmed. Pin + monitor at most; not a primary control. | [openai-guardrails-js](https://github.com/openai/openai-guardrails-js) |

---

## Appendix A — What already exists in Vitalis (do NOT rebuild) vs what is new

### Already exists — REUSE / EXTEND (verified in repo)

| Existing asset | What it already enforces | Failure covered | How to EXTEND (not replace) |
|----------------|--------------------------|-----------------|------------------------------|
| **Canonical dosing engine** (`BLEND_SCHEDULES`, `selectedScheduleFor`, `blendScheduleFor` in `packages/protocol-core/data/dosing.js`; consumed by `generator.js`, `document-model.js` — grep-confirmed) | Single dosing authority; consumed-not-duplicated | F3 | Add invocation-count logging + `trajectory:tool-used` assertion |
| **`research-doctrine.js`** (`EXCLUDED_IDS`, `isEvidenceAuthority=false`, `appFacingRegistry`) gated by **RD1–RD4** | Read-then-cite; HIGH-tier needs explicit confidence/citation | F6, F1 | Use as the "context" payload in a Lynx/grounding gate; keep RD1–RD4 as hard stops |
| **`scripts/check-catalog-guard.cjs`** (prebuild gate, wired as npm `prebuild` — verified) | Forbidden-string / catalog assertions at build (regex today) | F1, F3 | Swap ad-hoc string checks for Ajv-standalone JSON-Schema validation; add a grep gate "no dosing schedule outside protocol-core" |
| **Approval gate DRAFT→APPROVED_RESOURCE** (`gates.clientProtocolProjection`, server-side whitelist; acceptance test N3) | Server-authoritative softening at the client boundary only | F4, F5 | Make it the resume-authority for a LangGraph `interrupt()`; require a human-signed token |
| **Plain-node acceptance suite** (`node test/acceptance.js` — verified, 142KB) — honest range/UNKNOWN asserts | Output correctness | F3, F4, F6 | Add promptfoo assertions, pass^k multi-run, invocation-count asserts; wire as a **blocking** CI gate on agent PRs |
| **Doctrine docs** (BUILD-PROTOCOL §2/§3/§8, AGENT-PROMPT-PREAMBLE) | The human-readable rules | F1, F2, F5, F7 | Mirror into a machine-loaded `AGENTS.md`/`CLAUDE.md`; make the Start Gate a validated structured artifact |
| **Telegram bot** (`@NehemiahMarcBot`) | Operator notification channel | F5, F7 | Wire as the DLQ retry-exhaustion escalation target |
| **Claude Agent SDK** (current runtime) | The agent loop | F1, F2, F3, F6, F7 | Use `allowedTools` scoping + 4-element subagent specs; do NOT rely on subagent hooks |

### Genuinely NEW (net-new capability to add)
1. **Repeatable visual-QA harness** — Playwright `toHaveScreenshot` config + baselines + side-by-side vs Eric PDF / LIVE dossier; optionally Argos CI. **(closes F5 — the #1 gap; the `@playwright/test` dependency already exists at the `luke-app` root but is unwired for Vitalis, so the harness — config + baselines — is the new build)**
2. **Trajectory/tool-use assertions** — promptfoo wired into the acceptance suite. *(F3, F1)*
3. **Schema-as-build-gate** — Zod v4 canonical schemas + Ajv-standalone inside the prebuild guard. *(F3, F4, F6)*
4. **Dead-code + release-rationale gates** — Knip + Changesets. *(F3, F1, F2)*
5. **Domain lint** — Spectral ruleset over catalog JSON + agent artifacts. *(F1, F4)*
6. **Machine-checkable Start Gate** — a Zod-validated structured artifact with required non-empty/UNKNOWN-flagged fields; blocked while any field is UNKNOWN. *(F1, F6)*
7. **Write-ahead intent log + invocation-count assertions + DLQ** — plain-Node forensic/procedural layer. *(F5, F6, F3)*
8. **`AGENTS.md`/`CLAUDE.md` standing orders** — machine-loaded canonical constraints, updated after every observed failure. *(F1, F3, F6)*
9. **(Later) Runtime observability** — Langfuse self-host + OpenLLMetry-js OTel spans. *(F3, F7, F6)*

---

## Appendix B — Open unknowns / sources needing follow-up

1. **Playwright topology (verified on disk, conductor reconciliation).** `@playwright/test ^1.59.1` **is** installed at the outer `luke-app` repo root (`luke-app/package.json` devDeps + `package-lock.json` + `node_modules`) with a root `playwright.config.js` that targets a *separate* app (`:3000`), **not** Vitalis. The Vitalis subproject (`vitalis-resource-app/`) has no config/harness/baselines of its own. Budget the **dependency as ~free** and the **Vitalis visual harness (config + baselines) as a low-cost new build**. *(Does not change the recommendation — it remains #1 — only its cost framing.)*
2. **Galileo `galileo-js` Context-Adherence metric — UNVERIFIED.** Live fetch surfaced only `correctness`/`output_tone`; the "Context Adherence confirmed in `metrics.types.ts`" claim could not be reproduced. **Confirm the metric exists in the JS SDK before relying on it for F6.** ([galileo-js](https://github.com/rungalileo/galileo-js))
3. **promptfoo `trajectory:tool-used` assertion type + "350k+ developers / used by Anthropic" figures — not reproducible on the repo landing page.** The landing page confirms MIT/OSS/OpenAI-acquired/v0.121.14, plus "10M+ users / 435 dependents / 21.8k★," but did not enumerate the specific assertion type or those headline figures. **Confirm `trajectory:tool-used` against the promptfoo assertions docs before wiring it.** ([promptfoo](https://github.com/promptfoo/promptfoo))
4. **Vercel AI SDK API surface — corrected.** `generateObject` is replaced by `Output.object()` + `generateText` in AI SDK 6; **pin to the AI SDK 6 `Output` API** if adopted. ([ai-sdk.dev](https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-object))
5. **Claude Agent SDK subagent-hook bypass (issue #34692).** Rests on a 2025 GitHub issue; **verify current behavior** before designing enforcement around hooks vs the prebuild gate. ([subagents](https://code.claude.com/docs/en/agent-sdk/subagents))
6. **LangGraph.js HITL-resume-with-checkpoint (issue #1308).** Open JS issue on resume-not-working with checkpointing; **reproduce on the target version** before committing the `interrupt()` pattern. ([langgraphjs](https://github.com/langchain-ai/langgraphjs))
7. **OpenLIT CommonJS interop.** TS SDK is native OTel and OTel-JS assumes CJS compilation, but **confirm `require()` works in the Vitalis `.cjs` server** before adoption. ([openlit](https://github.com/openlit/openlit))
8. **`@openai/guardrails` npm package name + maturity.** Repo is `openai-guardrails-js`; npm name `@openai/guardrails` is **unconfirmed** from the repo URL alone; ~87★/v0.2.x. ([openai-guardrails-js](https://github.com/openai/openai-guardrails-js))
9. **PromptLayer JS SDK — unconfirmed (Python-primary).** If a prompt registry is wanted, **default to Langfuse** (JS-first, self-host verified). ([Langfuse](https://github.com/langfuse/langfuse))
10. **Several governance citations are non-peer-reviewed preprints** — labeled above: arXiv 2603.20953, 2604.07988, 2603.03258, 2603.03116, 2505.11368, 2505.08638, 2603.10047, 2604.23178. **Treat as directional, not settled.** Peer-reviewed anchors that hold: [tau-bench (ICLR)](https://arxiv.org/abs/2406.12045) and the [position-bias study (AACL-IJCNLP 2025)](https://arxiv.org/abs/2406.07791).
11. **Two vendor-marketing sources with peripheral support for their specific claim:** [Honeycomb Agent Timeline](https://www.honeycomb.io/blog/honeycomb-launches-agent-observability-full-visibility-agentic-workflows) (Early Access, not GA) and the [Temporal Replay-2026 page](https://temporal.io/blog/replay-2026-product-announcements) (TS SDK mentioned only peripherally). **Don't treat either as a load-bearing dependency.**
12. **`maxDiffPixelRatio` / `threshold` Playwright options.** The live `test-snapshots` page confirmed `maxDiffPixels` + `stylePath` but did **not** show `maxDiffPixelRatio`/`threshold`. The page also frames baselines as committed-to-VCS and does not explicitly document auto-upload of expected/actual/diff. **Confirm both against the installed Playwright version** when configuring the harness. ([playwright.dev](https://playwright.dev/docs/test-snapshots))
