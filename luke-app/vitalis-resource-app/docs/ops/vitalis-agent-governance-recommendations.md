# Vitalis Agent Governance Recommendations

*Part of the Vitalis anti-drift research sprint · Research lead: Daniel · 2026-06-03 · Research-only — no product code changed.*

---

## How to read this document

This is a **rulebook for any agent (or human) building My Vitalis Health.** It does not replace the existing doctrine — it operationalizes it. The two human-readable anchors stay authoritative:

- [`docs/VITALIS-BUILD-PROTOCOL.md`](../VITALIS-BUILD-PROTOCOL.md) — the build protocol (Start Gate §2, Agent Routing §3, Drift Triggers §4, Protocol Document Rule §5, Dosing Ownership §6, Visual Acceptance Gate §8, Done Definition §9).
- [`docs/VITALIS-AGENT-PROMPT-PREAMBLE.md`](../VITALIS-AGENT-PROMPT-PREAMBLE.md) — the gate every build prompt opens with.

Supporting truth: [`docs/vitalis-research-doctrine.md`](../vitalis-research-doctrine.md) and [`docs/DEVELOPER-HANDOFF.md`](../DEVELOPER-HANDOFF.md).

Each rule below names **(a)** the concrete action, **(b)** the practice or tool that backs it with a source link, and **(c)** which Vitalis failure mode (F1–F7) it closes. Every tool carries its maturity and a `vendor claim` / `UNKNOWN` label where Daniel's verified KB required one.

**The failure modes this rulebook exists to stop** (all documented as REAL and recurring in Vitalis's own doctrine — the founding line: *"agents patched important systems from memory, built parallel logic, and made outputs safer-sounding but less useful"*):

| ID | Failure | One-line |
|----|---------|----------|
| **F1** | Ignored the existing protocol/product standard | Built without anchoring to the LIVE peptide dossier / Eric PDF standard. |
| **F2** | Solo-patched instead of routing to read-only specialists | Jumped to Implementation without Source-Extraction + Current-System-Map first. |
| **F3** | Built a parallel dosing system | Re-implemented dosing instead of reusing `BLEND_SCHEDULES` / `selectedScheduleFor` / `blendScheduleFor`. |
| **F4** | Softened specific content into vague compliance language | Replaced the curated Section-02 schedule with ranges / hedged framing. |
| **F5** | Claimed DONE on green tests while the visual/product standard failed | "Tests pass" with no browser proof. |
| **F6** | Coded/claimed from memory instead of reading canonical sources | Asserted dosing/citations/tiers without an in-session source read. |
| **F7** | Inconsistently used proper subagents/tooling | Skipped or mis-sequenced the four-phase pipeline; wrong export engine. |

**Ground-truth verified for this sprint (live, 2026-06-03):** `packages/protocol-core` holds the canonical engine (`BLEND_SCHEDULES`/`selectedScheduleFor`/`blendScheduleFor` confirmed in `generator.js`, `data/dosing.js`, `document-model.js`); [`scripts/check-catalog-guard.cjs`](../../scripts/check-catalog-guard.cjs) is wired as the npm `prebuild` hook and does **string/projection** checks (not JSON-Schema); `npm test` → `node test/acceptance.js`; **`@playwright/test` is already installed at the outer `luke-app` repo root, and a root `playwright.config.js` exists — but it targets a *separate* app (`:3000`), not Vitalis; the Vitalis product (`vitalis-resource-app/`) has no visual-QA config, harness, or baselines of its own** — so the §8 visual gate is currently manual. That gap is the single highest-leverage net-new capability and the throughline of this rulebook.

**Reuse over rebuild.** Vitalis already owns 3 of the 4 enforcement primitives the literature prescribes: `check-catalog-guard.cjs` (spec-as-truth), RD1–RD4 (read-then-cite), and the server-authoritative `DRAFT → APPROVED_RESOURCE` gate. This sprint is **extension, not greenfield.**

---

## 1. Mandatory preflight gates

**Rule 1.1 — Run the existing Start Gate, and treat it as a structured artifact, not prose.**
Before any edit to a §1 core system, fill the Start Gate from [`VITALIS-BUILD-PROTOCOL.md` §2](../VITALIS-BUILD-PROTOCOL.md) (`CANONICAL SOURCE(S) FOUND`, `LEGACY / PRIOR STANDARD READ`, `CURRENT IMPLEMENTATION FILES`, `WHAT MUST BE REUSED`, `WHAT MUST NOT BE REBUILT`, …). The doctrine already says *"If any field is unknown, stop and discover it before coding."* The upgrade: make the gate **machine-checkable** — required fields must be non-empty or explicitly `UNKNOWN`-flagged, and work is blocked while any field is `UNKNOWN`.
- **Backed by:** [Anthropic — Building Effective Agents](https://www.anthropic.com/research/building-effective-agents) (2024-12-19, established) "evaluator-optimizer / deterministic gates"; spec-as-executable-truth — [Spec-Driven Development](https://medium.com/@nprasads/spec-driven-development-in-the-age-of-ai-from-specs-as-documents-to-specs-as-executable-truth-9b9e066712b1) (2026-02-04, emerging). Validate the gate object with **Zod v4** ([github.com/colinhacks/zod](https://github.com/colinhacks/zod), v4.4.3, May 2026, MIT, production — JSON-Schema conversion built in, verified).
- **Closes:** F1, F6.

**Rule 1.2 — Every factual/structural field in the Start Gate must point at a source read *in this session*.**
`CANONICAL SOURCE(S) FOUND` and `LEGACY / PRIOR STANDARD READ` must be concrete artifacts — a file path/line, a DOI, or a registry entry — never "from memory." Absent a verifiable source, emit an honest label (`UNKNOWN` / `SOURCE_PENDING` / `NEEDS_REVIEW`) and stop (matches [`vitalis-research-doctrine.md` §Honest labels](../vitalis-research-doctrine.md)).
- **Backed by:** context-rot mitigation — [Chroma context-rot](https://www.trychroma.com/research/context-rot) (2025-07-14, established): JIT-fetch canon per task, never recall it from earlier in a long session. Domain-guideline prioritization — [GuideBench, Diao et al., arXiv 2505.11368](https://arxiv.org/abs/2505.11368) (2025-05-16, **preprint** — directional): Vitalis rules **supersede** general medical knowledge.
- **Closes:** F6, F1.

**Rule 1.3 — Classify the task before invoking any tool or agent.**
Route each request into a lane (protocol-doc / evidence-synthesis / compliance / dosing) up front so a dosing task can't wander into rewriting evidence as vague safety language.
- **Backed by:** routing pattern — [Claude Common Workflow Patterns](https://claude.com/blog/common-workflow-patterns-for-ai-agents-and-when-to-use-them) (2026-03-05, established).
- **Closes:** F4, F7.

**Rule 1.4 — The always-on prebuild guard is a preflight gate, not a formality.**
[`check-catalog-guard.cjs`](../../scripts/check-catalog-guard.cjs) (npm `prebuild`) must stay green. Extend it from ad-hoc string checks to **declared JSON-Schema validation** of catalog/protocol objects using **Ajv standalone** (compiles schemas to pure-JS functions shippable inside the `.cjs` gate; CommonJS `require()` confirmed) — [github.com/ajv-validator/ajv](https://github.com/ajv-validator/ajv) (v8.20.0, Apr 2026, MIT, production). Pair with a **Spectral** ruleset for domain lint ("every compound has `evidence_tier`", "no CJC+Tesa together") — [github.com/stoplightio/spectral](https://github.com/stoplightio/spectral) (v6.15, Apr 2025, Apache-2.0, production).
- **Closes:** F1, F3, F4.

---

## 2. When to use subagents

The doctrine's [§3 Agent Routing](../VITALIS-BUILD-PROTOCOL.md) defines four read-only specialists: **Source-Extraction → Current-System-Map → Implementation → QA/Visual.** These rules say *when* that machinery is justified and *how* to spec it — the goal is to prevent both under-delegation (F2) and over-delegation (waste + new F3 vectors).

**Rule 2.1 — Default to NOT adding an agent. A canonical lookup is a tool call, not an agent task.**
A `BLEND_SCHEDULES` read, a `check-catalog-guard.cjs` run, a test run, a file-read of `research-doctrine.js` are **tool/subprocess calls.** Spawning an agent to do them is waste and an F3 vector (an agent "helpfully" reconstructing dosing is exactly the parallel-system failure).
- **Backed by:** [Anthropic — Building Effective Agents](https://www.anthropic.com/research/building-effective-agents) (2024-12-19, established): exhaust single-agent / prompt-chaining first. [niteagent post-mortem](https://niteagent.com/blog/multi-agent-production-2026/) (2026-05-15, established): don't add agents under ~128K tokens, for sequential shared-state work, or when a deterministic tool exists (multi-agent uses ~15× tokens).
- **Closes:** F3, F7.

**Rule 2.2 — Use the four-specialist split when the task is a full multi-section document build or spans doctrine + documents + gates.**
That is where single-pass reliability breaks down and where the orchestrator-workers pattern pays off.
- **Backed by:** [Anthropic — multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) (2025-06-13, established): orchestrator plans/synthesizes; workers do narrow isolated subtasks.
- **Closes:** F2, F3.

**Rule 2.3 — Give every subagent a 4-element spec: objective / output format / tools + sources / boundaries.**
Without it, "subagents duplicate work or leave gaps." For a multi-section protocol doc, the orchestrator calls `selectedScheduleFor` **once** and passes the serialized schedule object as locked ground-truth payload into each section subagent.
- **Backed by:** [Anthropic — multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) (2025-06-13, established); Enhanced Data Registry / single-task specialist chain — [Freeman et al., arXiv 2603.10047](https://arxiv.org/abs/2603.10047) (2026-03-08, **preprint** — directional): inject the *serialized human-readable schedule object*, not just the function name.
- **Closes:** F1, F2, F3, F6, F7.

**Rule 2.4 — The orchestrator is the single reader of canonical sources; subagents do not self-source.**
The orchestrator reads `research-doctrine.js` + the `BLEND_SCHEDULES` entry + the `check-catalog-guard.cjs` output **before** spawning anyone, and injects them as locked ground truth. Section subagents get read-only tools scoped to their section directory.
- **Backed by:** canonical-source injection — [Anthropic Managed Agents](https://platform.claude.com/docs/en/managed-agents/multi-agent) (date UNKNOWN, established). Tool scoping at registration — [Anthropic safe-agents framework](https://www.anthropic.com/news/our-framework-for-developing-safe-and-trustworthy-agents) (2025-08-04, established).
- **Closes:** F1, F6.

**Rule 2.5 — Scope read-only specialists at the tool-permission layer, on the runtime you already use.**
Vitalis already runs on the **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`, v0.3.162 confirmed Jun 3 2026, MIT, production — [code.claude.com/docs/en/agent-sdk/overview](https://code.claude.com/docs/en/agent-sdk/overview)). Give each analysis subagent `allowedTools` limited to Read + Glob + Grep; none gets write access to `BLEND_SCHEDULES` / `research-doctrine.js` / the approval whitelist.
- **Hooks caveat (preserve + verify):** Daniel's KB flags that PreToolUse/PostToolUse hooks *reportedly do NOT fire for subagent tool calls* ([Claude Agent SDK subagents](https://code.claude.com/docs/en/agent-sdk/subagents) + issue #34692, 2025, emerging). On live verification (2026-06-03), the current [hooks docs](https://code.claude.com/docs/en/agent-sdk/hooks) state hooks **do** fire inside subagents with `agent_id`/`agent_type` populated — so the #34692 behavior is **UNKNOWN / version-dependent and must be reproduced on the pinned SDK version before any enforcement is designed around hooks.** Either way the safe rule holds: **enforce read-only at the `allowedTools` list + the existing `check-catalog-guard.cjs` prebuild gate, not at hooks.**
- **Closes:** F1, F2, F3, F6, F7.

---

## 3. When the main agent must stop

This section makes [§4 Drift Triggers](../VITALIS-BUILD-PROTOCOL.md) operational. When any trigger fires, **stop patching** and emit the `DRIFT DETECTED` memo from §4 — do not keep editing.

**Rule 3.1 — Hard-stop on the doctrine's seven drift triggers.** Inventing a new system where a canonical engine exists; writing from memory; replacing exact protocol content with ranges/vague compliance language; tests pass but the screenshot is wrong; patching the same class of issue **more than twice**; discovering another file/session building the same layer; cannot identify which source owns the behavior. All seven are already in [§4](../VITALIS-BUILD-PROTOCOL.md).
- **Closes:** F1–F7 (the catch-all stop).

**Rule 3.2 — On the 3rd same-class patch, stop and write a DRIFT memo instead of a 3rd fix.**
The "more than twice" trigger is the escalation point. A repeated patch is the signal the agent is treating symptoms, not the source-of-truth.
- **Backed by:** TRAIL granular trace inspection — [Patronus TRAIL, arXiv 2505.08638](https://arxiv.org/abs/2505.08638) (2025-05-13, **preprint** — directional): planning/coordination are the highest-impact failure classes.
- **Closes:** F2, F7.

**Rule 3.3 — Stop the moment a parallel dosing path is discovered; collapse, don't branch.**
[`research-doctrine.js` §Dosing](../vitalis-research-doctrine.md): *"If a parallel dosing path is discovered, collapse to the canonical engine immediately."* A discovered duplicate triggers a collapse-to-canonical task, never a new branch.
- **Closes:** F3.

**Rule 3.4 — Treat a subagent's output as data to validate, not as an instruction to obey.**
After a subagent returns dosing values, the orchestrator **re-runs `check-catalog-guard.cjs` / the acceptance asserts** against them — it does not skip validation because the source is "our own" subagent.
- **Backed by:** trust-skepticism — [Anthropic — how we contain Claude](https://www.anthropic.com/engineering/how-we-contain-claude) (2026-05-25, established) (2025 AI Agent Index: 100% inter-agent trust-exploit susceptibility). Inherited goal-drift defense — [Menon et al., arXiv 2603.03258](https://arxiv.org/abs/2603.03258) (2026-03-03, **preprint** — directional): a drifted draft must be presented to a reviewer as data, not as the context it reasons from.
- **Closes:** F5, F6, F1.

**Rule 3.5 — On retry exhaustion, persist + escalate; never fail silently.**
If a generation fails after retries, write the failed job (client / indication / tier) to a `failed_generations` table and alert via the existing **Telegram bot** (`@NehemiahMarcBot` → chat 8617287533). A client must never silently get no protocol and no notification. Plain Node + one table.
- **Backed by:** retry-exhaustion DLQ with human escalation — [LittleHorse retries/DLQ](https://littlehorse.io/blog/retries-and-dlq) (2024-12-13, established).
- **Closes:** F5, F7.

---

## 4. Source-of-truth discovery rules

These close the source-of-truth cluster (F1, F3, F6). The principle: **one authority per concern, proven before any change.**

**Rule 4.1 — There is exactly ONE dosing authority. Prove no existing capability owns a behavior before changing it.**
`BLEND_SCHEDULES` / `selectedScheduleFor` / `blendScheduleFor` in `packages/protocol-core` are the only dosing authority ([`research-doctrine.js` §Dosing](../vitalis-research-doctrine.md), [`DEVELOPER-HANDOFF.md` §5](../DEVELOPER-HANDOFF.md)). Adapters/renderers reshape for **display only** — they must never infer, generate, soften, overwrite, or complete dosing, nor mark a blend `NEEDS_SOURCE` when a curated `BLEND_SCHEDULES` entry exists.
- **Backed by:** existing-capability discovery — [Anthropic — Building Effective Agents](https://www.anthropic.com/research/building-effective-agents) (2024-12-19, established).
- **Closes:** F3.

**Rule 4.2 — Make structural drift a hard build failure with one canonical schema.**
Express the `BLEND_SCHEDULES` shape + the approval whitelist as a single **Zod v4** schema ([github.com/colinhacks/zod](https://github.com/colinhacks/zod), v4.4.3, MIT, production, ESM+CJS); any agent-added field that doesn't conform fails `safeParse()`. Compile the same shape to a pure-JS validator via **Ajv standalone** ([github.com/ajv-validator/ajv](https://github.com/ajv-validator/ajv), v8.20.0, MIT, production, native CJS) and run it **inside `check-catalog-guard.cjs`**.
- **Limitation (preserve):** Zod validates *structure, not clinical values from memory* — pair with the source-read discipline (Rule 1.2) for F6.
- **Closes:** F3, F4, F6.

**Rule 4.3 — Catch the two "silent" source-of-truth leaks with dead-code + release-rationale gates.**
- **Knip** as a CI step surfaces an orphaned parallel-dosing file an agent created that nothing imports — [knip.dev](https://knip.dev/) (v6, ISC, production, monorepo-aware, verified). *(F3)*
- **Changesets** gates `protocol-core`: every change requires a human-written changeset declaring the semver bump + rationale, blocking silent agent bumps (anti-solo-patch paper trail) — [github.com/changesets/changesets](https://github.com/changesets/changesets) (MIT, production; Vitalis already has a `packages/protocol-core` monorepo). *(F1, F2)*
- **Closes:** F3, F1, F2.

**Rule 4.4 — Add a grep-based forbidden-pattern gate: no dosing schedule may be defined outside `protocol-core`.**
A CI assertion that no file outside `packages/protocol-core` defines a dosing schedule constant. This is the spec-as-executable-truth extension of the existing prebuild guard.
- **Backed by:** [Spec-Driven Development](https://medium.com/@nprasads/spec-driven-development-in-the-age-of-ai-from-specs-as-documents-to-specs-as-executable-truth-9b9e066712b1) (2026-02-04, emerging); framework-level guardrails LLMs cannot bypass — [AWS/DEV neurosymbolic guardrails](https://dev.to/aws/ai-agent-guardrails-rules-that-llms-cannot-bypass-596d) (2025-03-10, emerging).
- **Closes:** F1, F3.

**Rule 4.5 — Mark locked dosing decisions so any PR touching them triggers human review.**
Add `locked:true` / rationale markers (a `DECISIONS.json` or inline) to `BLEND_SCHEDULES` compound params; `AGENTS.md` points agents to read it before generation.
- **Backed by:** living spec with protected-decision markers — [Augment Code living specs](https://www.augmentcode.com/guides/living-specs-for-ai-agent-development) (2026-03-20, emerging).
- **Closes:** F1, F4, F6.

---

## 5. Visual QA requirements

**This is the highest-leverage net-new capability and it is low-cost — the dependency already exists.** `@playwright/test` is already installed at the `luke-app` root, but its root config targets a *separate* app, not Vitalis — there is no Vitalis config/harness/baselines — so [§8 Visual Acceptance Gate](../VITALIS-BUILD-PROTOCOL.md) is currently a manual process gate, the exact surface where "tests pass = done" (F5) recurs. The new work is a Vitalis-targeted config + baselines, not the dependency.

**Rule 5.1 — DONE requires browser-rendered visual proof, not just green tests.**
Per [§8 / §9](../VITALIS-BUILD-PROTOCOL.md): tests passing and build passing are *required but insufficient*; browser screenshots are required; *"Never call a task complete because the code compiles."* A "tests pass" signal alone is rejected as evidence of done.
- **Closes:** F5.

**Rule 5.2 — Stand up a repeatable visual harness with `Playwright toHaveScreenshot` (dependency already present at the `luke-app` root; the Vitalis harness is new).**
Pixel-diff rendered React pages (the dossier, each silo doc) against committed baselines; on mismatch Playwright uploads expected/actual/diff and exits 1 to gate CI. Use `maxDiffPixels` / `maxDiffPixelRatio` / `threshold` + `stylePath`/`mask` masking and `animations: 'disabled'` — all confirmed live on [playwright.dev/docs/test-snapshots](https://playwright.dev/docs/test-snapshots) (2026-06-03; resolves Daniel's KB open-unknown #10) (production, OSS).
- **Closes:** F5.

**Rule 5.3 — When rebuilding a known standard, attach a side-by-side vs the established reference.**
Per [§8](../VITALIS-BUILD-PROTOCOL.md): compare against the **Eric PDF / LIVE peptide dossier** (`PeptideProtocolDocument`, the "visual north star" per [`DEVELOPER-HANDOFF.md` §3](../DEVELOPER-HANDOFF.md)). Generate baselines in CI (different OS/fonts than local).
- **Backed by:** golden-file / snapshot drift gates — [Jest snapshot docs](https://jestjs.io/docs/snapshot-testing) (established): a snapshot update is a **human-reviewed drift event.**
- **Closes:** F4, F5.

**Rule 5.4 — (ADOPT LATER) Promote visual pass/fail to a first-class PR gate with Argos CI.**
Once Playwright screenshots exist, **Argos CI** adds a hosted diff-review UI + GitHub PR status check without committed baselines — [github.com/argos-ci/argos](https://github.com/argos-ci/argos) (freemium, OSS engine, production); more JS-native and cheaper than Chromatic/Percy.
- **Closes:** F5.

> **Do NOT add a second browser stack.** Vitalis has **no Storybook and no Jest**, so Chromatic / Storybook-VT / `jest-image-snapshot` mismatch, and BackstopJS would add a 2nd automation stack alongside Playwright. Avoid per System Consolidation Discipline. (Sources: [Chromatic](https://www.chromatic.com/pricing) *vendor claim*, [BackstopJS](https://github.com/garris/BackstopJS), [jest-image-snapshot](https://github.com/americanexpress/jest-image-snapshot).)

---

## 6. Eval / test requirements

The existing `node test/acceptance.js` suite (75/75) + RD1–RD4 + the prebuild guard **are the correct deterministic evaluator.** These rules extend the suite — they do not add an LLM judge on top of gates that already work.

**Rule 6.1 — Assert the agent called the canonical engine, with a trajectory/tool-use check.**
Add **promptfoo** wired into the existing `node test/acceptance.js` pattern. Its `trajectory:tool-used` / `trajectory:tool-sequence` assertion mechanically proves the agent invoked the canonical dosing engine rather than a parallel one; `agent-rubric` / `llm-rubric` graders catch softened language; `--fail-on-error` exits non-zero — [github.com/promptfoo/promptfoo](https://github.com/promptfoo/promptfoo) (v0.121.14, Jun 2 2026, MIT, production; OpenAI-acquired Mar 2026 but remains OSS — verified; the "used by OpenAI + Anthropic" usage claim is promptfoo's own marketing, *vendor claim*, [OpenAI acquisition note](https://openai.com/index/openai-to-acquire-promptfoo/)).
- **Closes:** F1, F3, F4, F5.

**Rule 6.2 — Test procedure separately from output: instrument invocation counts (catch "corrupt success").**
Right output via the wrong path is still F3. Instrument `selectedScheduleFor` / `blendScheduleFor` to log per-job invocation counts and assert `invocation_count > 0` for every generation — this catches a parallel path *even when it accidentally produces the correct answer.*
- **Backed by:** Procedure-Aware Evaluation — [Cao et al., arXiv 2603.03116](https://arxiv.org/abs/2603.03116) (2026-03-03, **preprint** — directional; study: 27–78% of benchmark "successes" violate procedure).
- **Closes:** F3, F5, F1.

**Rule 6.3 — Single-pass green is not evidence of reliability. Adopt pass^k.**
Run any suite test touching dosing / compound / protocol text **5+ times**, require consistent pass, and track variance. A single stochastic pass is not proof of canonical-standard adherence.
- **Backed by:** pass^k reliability testing — [tau-bench, Yao et al., arXiv 2406.12045](https://arxiv.org/abs/2406.12045) (2024-06-17, **ICLR peer-reviewed** — anchor that holds): strong models fall below 25% pass^8 on rule-following tasks.
- **Closes:** F5, F1.

**Rule 6.4 — FAIL on Section-02 degradation; allow softening ONLY at the approved client projection.**
Acceptance tests must FAIL if Section 02 degrades into prose-only dosing, broad ranges substituted for the selected schedule, or generic compliance text replacing specifics ([`VITALIS-BUILD-PROTOCOL.md` §5](../VITALIS-BUILD-PROTOCOL.md)). Softening is legitimate **only** in the server-side client projection of an `APPROVED_RESOURCE` — the operator-full / client-softened two-tier already encoded by acceptance test **N3** (`gates.clientProtocolProjection`, `CLIENT_VISIBLE_STATUS='APPROVED_RESOURCE'`).
- **Backed by:** existing N3 two-tier; [`research-doctrine.js` §Dosing + §Honest labels](../vitalis-research-doctrine.md).
- **Closes:** F4.

**Rule 6.5 — Keep RD1–RD4 as hard stops; the suite is the oracle agents call.**
RD1 (no WHO/NIH in registry), RD2 (gov never an evidence authority), RD3 (doctrine + lane hierarchy exist), RD4 (weak evidence stays honestly labeled). HIGH-tier claims must carry explicit confidence/citation. Wire the full suite as a **blocking** CI gate on agent PRs.
- **Backed by:** [`vitalis-research-doctrine.md` §Enforcement](../vitalis-research-doctrine.md); spec-as-truth — [Spec-Driven Development](https://medium.com/@nprasads/spec-driven-development-in-the-age-of-ai-from-specs-as-documents-to-specs-as-executable-truth-9b9e066712b1) (2026-02-04, emerging).
- **Closes:** F1, F6.

**Rule 6.6 — Use an LLM evaluator ONLY for non-verifiable voice/specificity, capped at 2 rounds, with bias control.**
Deterministic gates are the evaluator; an LLM judge on top of them creates F5. Reserve LLM eval for prose voice/specificity, cap at 2 rounds, and **constrain length/budget** so a style-biased judge doesn't rate verbose hedged text (the F4 failure) as higher quality.
- **Backed by:** evaluator-optimizer discipline — [Anthropic — Building Effective Agents](https://www.anthropic.com/research/building-effective-agents) (2024-12-19) + [AgentPatterns.ai](https://www.agentpatterns.ai/agent-design/evaluator-optimizer/) (2026-05-27, established) (Snorkel 2025: self-critique dropped accuracy to ~57% where the generator already hit ~98%). LLM-as-judge bias control — [Soumik, arXiv 2604.23178](https://arxiv.org/abs/2604.23178) (2026-04-25, **preprint** — directional) + [Shi et al., arXiv 2406.07791](https://arxiv.org/abs/2406.07791) (AACL-IJCNLP 2025, peer-reviewed).
- **Closes:** F4, F5.

> **(ADOPT LATER) grounding gate.** Before `DRAFT → APPROVED`, score protocol text against `research-doctrine.js` content as context with **Patronus Lynx** (official TS SDK v0.3.0 + REST; 8B open-weights for self-host) — [docs.patronus.ai/.../Lynx/base](https://docs.patronus.ai/docs/research_and_differentiators/Lynx/base) (freemium, production). **Do NOT** build on **Galileo's "Context Adherence"** metric: the `galileo-js` SDK is real (Apache-2.0, v2.2.0, May 2026) but the specific grounding metric is **UNKNOWN — not confirmed in live JS docs (only `correctness`/`output_tone` surfaced, verified 2026-06-03)** — [github.com/rungalileo/galileo-js](https://github.com/rungalileo/galileo-js).

---

## 7. Workflow recovery protocol

What to do when a gate trips, a drift fires, or a run fails — so failure becomes a logged, reviewable event rather than a silent or hand-patched one.

**Rule 7.1 — On `DRIFT DETECTED`, write the memo and stop; do not keep patching.**
Emit the [§4 memo](../VITALIS-BUILD-PROTOCOL.md) (`WHAT I WAS ABOUT TO DO` / `WHAT CANONICAL SOURCE I MISSED` / `WHAT I WILL COLLAPSE / REUSE` / `WHAT TEST OR VISUAL GATE WILL PREVENT RECURRENCE`). The last field is mandatory: a drift is not resolved until a test or visual gate exists to prevent recurrence.
- **Closes:** F1–F7.

**Rule 7.2 — Keep a write-ahead intent log; assert the canonical call actually happened.**
Append a structured intent entry immediately *before* each canonical tool call and update it with the result. The acceptance suite asserts the intent log contains a `blendScheduleFor()` / `selectedScheduleFor()` entry on every generation run — if absent, the agent bypassed the engine. This distinguishes *intended* from *actually called.*
- **Backed by:** write-ahead intent log — [LogAct, arXiv 2604.07988](https://arxiv.org/html/2604.07988v1) (2026-04-09, **preprint, Meta — directional**); TRAIL trace inspection — [arXiv 2505.08638](https://arxiv.org/abs/2505.08638) (2025-05-13, **preprint**).
- **Closes:** F5, F6, F3.

**Rule 7.3 — On retry exhaustion, persist to a DLQ table + escalate via Telegram, expose a reprocess endpoint.**
(Same mechanism as Rule 3.5, stated here as the recovery path.) A failed generation lands in `failed_generations`, pings `@NehemiahMarcBot`, and is re-runnable. Kills silent failure. Plain Node + one table.
- **Backed by:** [LittleHorse retries/DLQ](https://littlehorse.io/blog/retries-and-dlq) (2024-12-13, established).
- **Closes:** F5, F7.

**Rule 7.4 — (ADOPT LATER) Server-authoritative resume for multi-step approval flows.**
When agent flows become genuinely multi-step, an agent's `interrupt()` freezes state to Postgres/SQLite and returns proposed content to the Express endpoint; **only the server resumes** — extending the existing `DRAFT → APPROVED_RESOURCE` gate (`thread_id` = document ID). Implement at infra/middleware, not prompt.
- **Backed by:** [LangChain interrupt blog](https://www.langchain.com/blog/making-it-easier-to-build-human-in-the-loop-agents-with-interrupt) (2024-12-14, established) via **LangGraph.js** ([github.com/langchain-ai/langgraphjs](https://github.com/langchain-ai/langgraphjs), v1.x, Jun 2026, MIT, production). Pre-action authorization gateway — [arXiv 2603.20953](https://arxiv.org/pdf/2603.20953) (2026-03-24, **preprint, not peer-reviewed — directional**).
- **Caveat (preserve + verify):** the JS HITL-resume-with-checkpoint path had an open issue (#1308) — **UNKNOWN; reproduce on the pinned `@langchain/langgraph` version before committing.**
- **Closes:** F1, F2, F4.

---

## 8. Memory / documentation protocol

Memory is a soft aid, never an authority. The hard gates are the source of truth; documentation keeps the standing orders machine-loadable and current.

**Rule 8.1 — Add a root `AGENTS.md` / `CLAUDE.md` standing-orders file, loaded at session start.**
It declares: `blendScheduleFor` / `selectedScheduleFor` are the ONLY dosing authorities; `research-doctrine.js` is read-only; the approval gate is server-enforced; and a forbidden-string list mirroring `check-catalog-guard.cjs`. This mirrors the human-readable [`VITALIS-BUILD-PROTOCOL.md`](../VITALIS-BUILD-PROTOCOL.md) + [`VITALIS-AGENT-PROMPT-PREAMBLE.md`](../VITALIS-AGENT-PROMPT-PREAMBLE.md) into a machine-loaded form — it does not replace them.
- **Backed by:** sub-agent isolation + structured note-taking + CLAUDE.md/AGENTS.md standing orders — [Anthropic — context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) (2025-09-29, established).
- **Closes:** F1, F2, F3, F6.

**Rule 8.2 — Update the standing-orders file after every observed F1/F3/F4/F6.**
A drift event that recurs is a documentation gap. The `WHAT TEST OR VISUAL GATE WILL PREVENT RECURRENCE` line from each drift memo (Rule 7.1) feeds back into `AGENTS.md` + a new test.
- **Backed by:** living spec / bidirectional update — [Augment Code living specs](https://www.augmentcode.com/guides/living-specs-for-ai-agent-development) (2026-03-20, emerging).
- **Closes:** F1, F3, F4, F6.

**Rule 8.3 — JIT-fetch canon every generation; never trust "remembered" dosing/doctrine.**
Dosing-engine output, doctrine assertions, and blend schedules are fetched fresh per task from the canonical source — never recalled from earlier in a long session. Treat the suite + guard as oracles the agent calls.
- **Backed by:** context-rot mitigation — [Chroma context-rot](https://www.trychroma.com/research/context-rot) (2025-07-14, established).
- **Closes:** F6.

**Rule 8.4 — If a persistent memory layer is ever added, it is a complement, never an authority.**
**mem0** ([github.com/mem0ai/mem0](https://github.com/mem0ai/mem0), Jun 2026, Apache-2.0, production) could surface "current dosing standard" at session start — but it is a **soft memory layer, NOT a hard gate.** Pair it with `check-catalog-guard.cjs` + RD1–RD4; treating it as authority re-introduces the memory-as-truth failure (F6).
- **Closes:** F6.

> **(ADOPT LATER) prompt registry + runtime observability.** For prompt-version pinning ("which prompt did the agent use") and spans recording which dosing fn fired, prefer **Langfuse** (JS-first, self-host keeps protocol data local) — [github.com/langfuse/langfuse](https://github.com/langfuse/langfuse) (v3.178, Jun 2026, MIT, production; acquired by ClickHouse May 2026) — over Agenta (overlap) or **PromptLayer** (JS SDK **UNKNOWN** — Python-primary, *vendor claim*). Add backend-agnostic OTel spans via **OpenLLMetry-js** — [github.com/traceloop/openllmetry-js](https://github.com/traceloop/openllmetry-js) (v0.27, May 2026, Apache-2.0, production; **import-order gotcha — SDK must load before the LLM module**) on the [OpenTelemetry GenAI conventions](https://opentelemetry.io/blog/2026/genai-observability/) (attrs experimental).

---

## 9. How to prevent solo-patching

Solo-patching (F2) is named in [§1 "No Solo Patching On Core Systems"](../VITALIS-BUILD-PROTOCOL.md) and repeated across three doctrine docs — it is recurring, not hypothetical. These rules make "route, don't solo-patch" enforceable rather than aspirational.

**Rule 9.1 — For any of the ten §1 core systems, run discovery-and-routing BEFORE any Implementation edit.**
The ten triggers (protocol documents; dosing/schedules/blends; evidence tiers/source doctrine; lab interpretation; supplement logic; nutrition/meal logic; approval gates/projections; silo organization; billing/entitlement gates; design system) require Source-Extraction + Current-System-Map outputs to **exist** before an Implementation edit is allowed. *"The main agent is the conductor, not the whole orchestra."*
- **Closes:** F2.

**Rule 9.2 — If subagents/tooling are unavailable, declare it and perform the same phases in order — never skip.**
Per [§3](../VITALIS-BUILD-PROTOCOL.md): *"If the agent cannot use subagents/tooling, it must explicitly say so and manually perform the same phases in order. It may not skip the phases."* The four phases (Source-Extraction → Current-System-Map → Implementation → QA/Visual) each emit an observable artifact; QA/Visual emits a structured PASS/FAIL + screenshots.
- **Backed by:** single-task specialist chain + Reconciler — [Freeman et al., arXiv 2603.10047](https://arxiv.org/abs/2603.10047) (2026-03-08, **preprint** — directional): Compound-Selector (RO) → Schedule-Fetcher (RO, canonical engine only) → Narrative-Writer (write) → Compliance-Checker (RO); the approval gate plays Reconciler.
- **Closes:** F2, F7.

**Rule 9.3 — Make solo-patching structurally impossible at the permission + framework layer, not the prompt.**
"Prompts are suggestions — framework hooks are enforcement." Node middleware (the existing Express server-side projection) should reject any file-write to `protocol-core` from an analysis role, return BLOCKED on any call bypassing `blendScheduleFor`, and require a human-signed token to set `APPROVED_RESOURCE`. Scope analysis subagents to read-only `allowedTools` on the Claude Agent SDK.
- **Backed by:** framework-level guardrails LLMs cannot bypass — [AWS/DEV neurosymbolic guardrails](https://dev.to/aws/ai-agent-guardrails-rules-that-llms-cannot-bypass-596d) (2025-03-10, emerging); minimal-footprint tool scoping — [Anthropic safe-agents framework](https://www.anthropic.com/news/our-framework-for-developing-safe-and-trustworthy-agents) (2025-08-04, established); pre-action authorization gateway — [arXiv 2603.20953](https://arxiv.org/pdf/2603.20953) (2026-03-24, **preprint — directional**).
- **Closes:** F2, F3.

**Rule 9.4 — Require a Changesets paper trail on every `protocol-core` change.**
A human-declared rationale + semver bump per change makes a silent agent patch impossible to land unnoticed — [github.com/changesets/changesets](https://github.com/changesets/changesets) (MIT, production).
- **Closes:** F1, F2.

**Rule 9.5 — The 3rd same-class patch is a hard stop into a DRIFT memo (not a 3rd patch).**
(Cross-reference Rule 3.2.) Repeated same-class patching is the canonical solo-patch tell; the doctrine's "more than twice" trigger converts it into a stop-and-document event.
- **Closes:** F2, F7.

---

## Appendix A — Adoption ladder (mature/now vs experimental/later)

Bias: **JS-native, reuse existing enforcement, close the missing visual gate first.** Carried verbatim from Daniel's verdict.

### ADOPT NOW — production-ready, JS-native, zero/low friction, closes a failure directly
| Item | Maturity | F# | Why |
|------|----------|-----|-----|
| [Playwright `toHaveScreenshot`](https://playwright.dev/docs/test-snapshots) | production | F5 | Dependency already at the `luke-app` root (config targets a separate app); the Vitalis harness is a low-cost new build that converts the manual §8 gate into a CI-blocking one. **#1 leverage.** |
| [promptfoo](https://github.com/promptfoo/promptfoo) (`trajectory:tool-used` + rubric) | production (MIT) | F1, F3, F4, F5 | Proves the agent called the canonical engine; slots into `node test/acceptance.js`. |
| [Zod v4](https://github.com/colinhacks/zod) (canonical schemas) | production (MIT) | F3, F4, F6 | Makes "agent invented its own structure" a hard runtime error; ESM+CJS. |
| [Ajv standalone](https://github.com/ajv-validator/ajv) (inside the prebuild guard) | production (MIT) | F1, F3 | Upgrades `check-catalog-guard.cjs` from string checks to JSON-Schema; native CJS. |
| [Knip](https://knip.dev/) (CI step) | production (ISC) | F3 | Surfaces orphaned parallel-dosing files nothing imports. |
| [Changesets](https://github.com/changesets/changesets) (gate on `protocol-core`) | production (MIT) | F1, F2 | Forces a human-declared rationale; anti-solo-patch paper trail. |
| [Spectral](https://github.com/stoplightio/spectral) (catalog/artifact lint) | production (Apache-2.0) | F1, F4 | Domain lint; pairs with Ajv. |
| `AGENTS.md` / `CLAUDE.md` ([context-engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)) | established | F1, F3, F6 | Free; machine-loads canonical constraints; update after every failure. |
| [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview) read-only `allowedTools` + 4-element specs | production (MIT) | F1, F2, F3, F6, F7 | Already the runtime; enforce read-only at the permission layer (combine with prebuild gate — verify the subagent-hook behavior). |
| [Anthropic Structured Outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) (`output_config.format`) | production | F1, F6 | GA on Opus 4.8 (verified); zero new deps; no beta header. |
| pass^k + invocation-count asserts ([tau-bench](https://arxiv.org/abs/2406.12045), [PAE](https://arxiv.org/abs/2603.03116)) | peer-reviewed / **preprint** | F5, F3, F1 | Cheap suite changes catch corrupt success + stochastic non-adherence. |
| Write-ahead intent log + DLQ + Telegram ([LogAct](https://arxiv.org/html/2604.07988v1), [LittleHorse](https://littlehorse.io/blog/retries-and-dlq)) | **preprint** / established | F5, F6, F7 | Plain Node + one table; "intended vs actually called"; kills silent failure. |

### ADOPT LATER — real value, more setup or not yet load-bearing
| Item | Maturity | F# | Why |
|------|----------|-----|-----|
| [Argos CI](https://github.com/argos-ci/argos) | production | F5 | First-class visual PR gate once Playwright screenshots exist. |
| [Langfuse](https://github.com/langfuse/langfuse) (self-host tracing + prompt registry) | production (MIT) | F1, F6 | Prompt-version pinning + spans; pick over Agenta/PromptLayer. |
| [OpenLLMetry-js](https://github.com/traceloop/openllmetry-js) + [OTel GenAI](https://opentelemetry.io/blog/2026/genai-observability/) | production / emerging | F3, F7 | Backend-agnostic spans; mind the import-order gotcha. |
| [LangGraph.js `interrupt()`](https://www.langchain.com/blog/making-it-easier-to-build-human-in-the-loop-agents-with-interrupt) + Postgres checkpointer | production (MIT) | F1, F2, F4 | Durable server-gated resume; **verify JS HITL-resume issue #1308 first.** |
| [Patronus Lynx](https://docs.patronus.ai/docs/research_and_differentiators/Lynx/base) (post-gen grounding) | production | F6, F1 | Scores protocol text vs `research-doctrine.js` before approve. |
| [Inngest AgentKit](https://github.com/inngest/agent-kit) / [Temporal TS](https://temporal.io/blog/replay-2026-product-announcements) *(vendor claim)* | emerging / production | F5, F7 | Durable execution only once generation > ~5 min; Inngest first. |
| [mem0](https://github.com/mem0ai/mem0) | production | F6 | Soft session-start grounding — complement to hard gates, never authority. |

### AVOID-OVERKILL / NOT-NOW — wrong stack, redundant, or mismatched
| Item | F# | Why |
|------|-----|-----|
| Guidance / llguidance / Outlines / XGrammar / jsonformer | F1, F6 | Run inside inference servers; Vitalis calls hosted APIs — infra context only. |
| BackstopJS / [Chromatic](https://www.chromatic.com/pricing) *(vendor claim)* / Percy / Storybook-VT / [jest-image-snapshot](https://github.com/americanexpress/jest-image-snapshot) | F5, F3 | Playwright already covers diffing; no Storybook, no Jest — parallel tooling (Consolidation Discipline). |
| NeMo Guardrails / LLM Guard / Presidio / Llama Guard 3 / Pangea / Guardrails AI | F4 | Python-or-SaaS; taxonomies (violence/PII/CSAM) don't match dosing-drift. |
| AG2 (AutoGen) / Inspect / Ragas / TruLens / Cleanlab / DeepEval (as primary) | F4, F7 | Python-only or not-RAG — a Python boundary violates Operational Simplicity. |
| [OpenAI Agents SDK JS](https://github.com/openai/openai-agents-js) | F2, F7 | OpenAI-model-tied; Vitalis is Claude-native. |
| [Instructor JS](https://github.com/567-labs/instructor-js) | F5 | Last release Jan 2025 (>1yr stale); native `output_config` is lower-risk. |
| Datadog LLM Observability | F5, F7 | Cost-prohibitive greenfield. |
| [Rebuff](https://github.com/protectai/rebuff) | F6 | **ARCHIVED May 2025 — do not adopt.** |
| Galileo "Context Adherence" reliance | F6 | SDK real, but the grounding metric is **UNKNOWN** in live JS docs — don't build on it. |

---

## Appendix B — What already exists (REUSE / EXTEND, do NOT rebuild)

| Existing asset | Already enforces | Covers | Extend (not replace) |
|----------------|------------------|--------|----------------------|
| Canonical dosing engine (`BLEND_SCHEDULES`, `selectedScheduleFor`, `blendScheduleFor` in `packages/protocol-core`; consumed by `generator.js`, `document-model.js`) | Single dosing authority | F3 | Invocation-count logging + `trajectory:tool-used` |
| [`research-doctrine.js`](../vitalis-research-doctrine.md) gated by RD1–RD4 | Read-then-cite; HIGH-tier needs confidence/citation | F6, F1 | Use as "context" in a Lynx grounding gate; keep RD1–RD4 hard |
| [`scripts/check-catalog-guard.cjs`](../../scripts/check-catalog-guard.cjs) (npm `prebuild`) | Forbidden-string / catalog asserts | F1, F3 | Swap string checks → Ajv JSON-Schema; add grep "no dosing outside protocol-core" |
| Approval gate `DRAFT → APPROVED_RESOURCE` (`gates.clientProtocolProjection`; acceptance test N3) | Server-authoritative softening at client boundary only | F4, F5 | Resume-authority for `interrupt()`; require human-signed token |
| Acceptance suite (`node test/acceptance.js`, 75/75; honest range/UNKNOWN asserts) | Output correctness | F3, F4, F6 | promptfoo asserts + pass^k + invocation-count; wire as **blocking** CI |
| Doctrine docs ([BUILD-PROTOCOL](../VITALIS-BUILD-PROTOCOL.md), [PREAMBLE](../VITALIS-AGENT-PROMPT-PREAMBLE.md)) | Human-readable rules | F1, F2, F5, F7 | Mirror into machine-loaded `AGENTS.md`; validate the Start Gate as a structured artifact |
| Telegram bot (`@NehemiahMarcBot` → chat 8617287533) | Operator notification | F5, F7 | DLQ retry-exhaustion escalation target |
| [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview) (current runtime) | The agent loop | F1, F2, F3, F6, F7 | `allowedTools` scoping + 4-element specs; verify subagent-hook behavior |

---

## Appendix C — Open unknowns flagged for follow-up

Preserved from Daniel's verified KB; **do not build load-bearing dependencies on these until confirmed.**

1. **Galileo `galileo-js` Context-Adherence metric — UNKNOWN.** Live fetch (2026-06-03) surfaced only `correctness` / `output_tone`; the "confirmed in `metrics.types.ts`" claim could not be reproduced. Confirm before using for F6.
2. **Claude Agent SDK subagent-hook behavior — UNKNOWN / version-dependent.** Daniel's KB cites issue #34692 (hooks don't fire for subagents); current docs say they do fire with `agent_id`/`agent_type`. Reproduce on the pinned SDK version before designing enforcement around hooks. Either way, enforce at `allowedTools` + the prebuild gate.
3. **LangGraph.js HITL-resume-with-checkpoint (issue #1308) — UNKNOWN.** Reproduce on the target `@langchain/langgraph` version before committing the `interrupt()` approval pattern.
4. **OpenLIT / OTel-JS CommonJS interop — confirm before committing** (Vitalis `.cjs` server). [OpenLIT](https://github.com/openlit/openlit) TS SDK is native OTel; OTel-JS assumes CJS compilation, so it is likely workable.
5. **`@openai/guardrails` npm name + maturity — UNKNOWN** (repo is `openai-guardrails-js`; only 87★/v0.2.x; OpenAI-client-shaped vs Vitalis-Claude). Verify before any use.
6. **PromptLayer JS SDK — UNKNOWN** (Python-primary; SDK path 404'd). If a prompt registry is wanted, default to **Langfuse** (JS-first, self-host verified).
7. **Vercel AI SDK surface — corrected:** `generateObject` is replaced by `Output.object()` + `generateText` in AI SDK 6 — [ai-sdk.dev](https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-object). Pin to the AI SDK 6 `Output` API if adopted.
8. **Non-peer-reviewed preprints — treat as directional, not settled:** arXiv 2603.20953, 2604.07988, 2603.03258, 2603.03116, 2505.11368, 2505.08638, 2603.10047, 2604.23178. Peer-reviewed anchors that DO hold: [tau-bench (ICLR, 2406.12045)](https://arxiv.org/abs/2406.12045) and the [position-bias study (AACL-IJCNLP 2025, 2406.07791)](https://arxiv.org/abs/2406.07791).
9. **Vendor-marketing sources, peripheral support for their specific claim:** Honeycomb Agent Timeline (Early Access, not GA) *(vendor claim)* and the Temporal Replay-2026 page (TS SDK mentioned only peripherally) *(vendor claim)* — don't treat either as a load-bearing dependency.
10. **Playwright `maxDiffPixelRatio` / `threshold` — RESOLVED (verified 2026-06-03):** confirmed live on [playwright.dev/docs/test-snapshots](https://playwright.dev/docs/test-snapshots) alongside `maxDiffPixels` + masking. Confirm exact options against the installed Playwright version when configuring the harness.
