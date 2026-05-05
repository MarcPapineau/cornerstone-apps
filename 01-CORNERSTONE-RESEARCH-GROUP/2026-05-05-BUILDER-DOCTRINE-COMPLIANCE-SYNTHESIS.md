# Builder Doctrine Compliance — Synthesis & Patch Plan

**Date:** 2026-05-05
**Trigger:** Marc directive — "Builder must not merely deploy code. Builder must become the doctrine-compliant agent builder."
**Method:** 4 parallel Opus 4.7 investigators — Memory + Workspace + Repo+Skills + main.py compliance — clean context, evidence-only.
**Final status:** `BUILDER_STATUS = INCOMPLETE`

---

## §1. DOCTRINE SOURCE FILES FOUND

### 1.1 Memory store (~80 files)
Path: `/Users/marcpapineau/.claude/projects/-Users-marcpapineau--openclaw-workspace/memory/`

- `MEMORY.md` — canonical index (200+ lines, auto-loaded each session)
- 24 `rule_*.md` files (anti-drift 1-7, gate-c, gate-f, gate-g, model-selection, subagent-routing, wku-framework, build-pipeline, github-version-control, query-doppler-first, rotation-is-levites-job, marc-facing-docs-format, research-first-build-process, agent-build-prompt-process)
- 22 `feedback_*.md` files (anti-drift block v2, theater-pattern-named, gate-pass-language-banned, communication-style, autonomous-decision-authority, time-estimation-calibration, role-based-agent-naming, orchestrator-anti-pattern-block, never-use-haiku-for-research)
- 9 `doctrine_*.md` files (crg-internal-focus, knowledge-tiers, self-learning-loops, xml-task-decomposition, crg-build-pipeline-v2, recommendation-coherence, vitalis-protocol-package-pattern)
- 5 `reference_*.md` files (apps-canon, credentials-locations, session-resume-protocol, managed-agents-resources)
- Plus: 2 skill_*, 5 project_*, 4 user_*, 1 template_*, 1 state_*

### 1.2 Workspace `01-CORNERSTONE-RESEARCH-GROUP/`
Path: `/Users/marcpapineau/.openclaw/workspace/01-CORNERSTONE-RESEARCH-GROUP/`

| File | Lines | Authority |
|---|---|---|
| `BUILD-AGENT-OPERATING-MANUAL-v1.md` | 175 | OPERATING |
| `BUILD-AGENT-SYSTEM-PROMPT-v2.md` | 236 | SYSTEM PROMPT |
| `BUILD-AGENT-RESEARCH-2026-04-25.md` | 313 | RESEARCH BASIS |
| `BUILD-AGENT-PLAN.json` | 392 | STRUCTURED PLAN |
| `AGENT-OPERATING-MODEL.md` | 130 | TIER MATRIX |
| `AGENT-WORKFLOW-ARCHITECTURE.md` | 357 | FLEET ARCH |
| `EVALUATION-GRADING-FRAMEWORK-v1.md` | 314 | KRITE 5-AXIS |
| `SUPER-AGENT-BUILD-PHILOSOPHY-v1.md` | 214 | MULTI-VOICE |
| `SELF-LEARNING-LOOP-v1.md` | 204 | INNER/OUTER LOOP |
| `2026-05-04-CRG-BUILD-DOCTRINE-v2-CORRECTED.md` | 273 | **SUPERSEDES** |
| `2026-05-04-CRG-THEATER-AUDIT-FULL-REPORT.md` | 178 | **EVIDENCE** |
| `2026-04-29-BEZALEL-VITALIS-AGENT-BUILD-DISPATCH.md` | 276 | TEMPLATE BUILD |
| `AGENT-HANDOFF-PATTERN.md` | 90 | BUS PATTERN |
| `MARC-AUTHORING-PROMPTS-v1.md` | 319 | XML INTAKE TEMPLATES |

### 1.3 cornerstoneregroup-site/

**docs/ (canonical operational contracts)**
- `BUILDER-DISPATCH-TEMPLATE.md` (119) — Habakkuk footer mandate
- `AGENT-SELF-IMPROVEMENT-FRAMEWORK.md` (218) — SI 7-step playbook
- `AGENT-FEEDBACK-API.md` (188) — failure-mode + reference-curate URLs

**agents/ (18 specs)**
- `karis.md` (147), `habakkuk.md` (110), `daniel.md` (123), `samuel.md` (90 PLACEHOLDER), `apollos.md` (262)
- `nehemiah.md` (89 PLACEHOLDER), `eod.md` (94 PLACEHOLDER)
- `asaph.md`, `lydia.md`, `martha-vm.md`, `aaron-daily.md`, `aaron-weekly.md`, `asher-protocol-package.md`, `asher-weekly-research.md`, `boaz-daily.md`, `boaz-weekly.md`, `martha-daily.md`

**Production code that operationalizes doctrine:**
- `netlify/functions/_lib/anti-drift-block.js` (110) — **canonical v2 block + 10-marker `verifySystemPromptContainsBlock()`**
- `netlify/functions/_lib/habakkuk-pattern-checks.js` (783) — **9 deterministic patterns A–I**
- `netlify/functions/_lib/habakkuk-critic.js` (974) — 6-axis structural critic
- `netlify/functions/_lib/agent-self-improvement-prompt-block.js` (134)
- `netlify/functions/_lib/agent-self-improvement.js` (712)
- `netlify/functions/_lib/agent-self-critique-rubrics.js` (362)

**scripts/qa/ (enforcement v1, my commit b924490)**
- `enforce.sh`, `enforce-config.json`, `lib/{claim-parser, gate-output-validator, runtime-verifier}.js`, `lib/gate-output-schema.json`

**data/**
- `agents-registry.json` (only Habakkuk currently registered — fleet enrollment incomplete)
- `karis-test-plans.json` (luke-pos test plan = canonical pattern)
- `agents/scorecards/*.json` (15 files), `agents/rubrics/*.json` (12 files)

**skills/crg/ (15 Claude Code skills)**
- `foundation-audit`, `silo-router`, `nightly-research`, `morning-brief-builder`, `project-manager`, `runtime-heartbeat`, `drift-detector`, `samuel-digest-writer`, `abigail-call-doctrine`, `session-startup`, `session-closedown`

### 1.4 Existing commits referenced in this synthesis
- `cornerstoneregroup-site` — `b924490` (enforcement v1)
- workspace — `dc20a04` (theater audit), `ea1a4e0` (Build Doctrine v2 CORRECTED), `a9e6afb` (Builder deployed + main.py first commit)

---

## §2. DOCTRINE REQUIREMENTS EXTRACTED

After deduplication, **~200 distinct requirements** across 9 categories. Cited inline by category.

### 2.1 Agent build process (combined: ~30 reqs)

| ID | Requirement | Source |
|---|---|---|
| **BP-1** | 7-step Build pipeline: Intake → Research → Adapt+WKU → Build runtime → Test-fire → KRITE → Ship as BUILT (LIVE only after 7 days of traces, auto-promoted by Samuel) | OPERATING-MANUAL-v1.md, SYSTEM-PROMPT-v2.md |
| **BP-2** | **v2 SUPERSEDING:** ACTUAL fireable pipeline = Marc intent → spec → feature branch → Habakkuk pre-build → commit-with-evidence → Marc merge → deploy → Langfuse trace observed | 2026-05-04-CRG-BUILD-DOCTRINE-v2-CORRECTED.md §1 |
| **BP-3** | One singular canonical Build Agent that builds every other agent | OPERATING-MANUAL-v1.md:9-11 |
| **BP-4** | Bezalel-style 9-phase template for domain agents: winners-research → persona-synthesis → corpus-index → system prompt → runtime → test-fire → KRITE → Karis → Marc | BEZALEL-DISPATCH:103-162 |
| **BP-5** | Cost target ~$0.30/build; max_turns 25; max_budget_usd_per_run 1.0 | BUILD-AGENT-PLAN.json:18-20 |
| **BP-6** | Marc's 4 authoring templates (BUILD/WORK/APPROVE/ACTIVATE) — strict XML; free-form Marc message → "fill the template, I'll wait" | MARC-AUTHORING-PROMPTS-v1.md:26-302 |
| **BP-7** | `crg:project-manager` skill = orchestrator entry; produces 1-paragraph spec in 60s; only 5 escalation triggers (cost > $50; client data/money; arch decisions; T1-vs-T2 conflict; theology) | skills/crg/project-manager.md:48-85 |
| **BP-8** | Sub-Builder propagation: every dispatched sub-Builder receives Habakkuk footer verbatim | BUILDER-DISPATCH-TEMPLATE.md:67-68 |
| **BP-9** | NO INLINE EDITS to production artifacts; feature branch + KRITE+Karis verdicts before merge | anti-drift-block.js:62 |
| **BP-10** | Build Agent v1 / KRITE-as-build-time-reviewer / Karis / Independent Validator / Bezalel runtime / Judge — currently DEFERRED. Use of names without DEFERRED tag is doctrine violation | Doctrine v2 §3 |

### 2.2 Required tools + skills (combined: ~15 reqs)

| ID | Requirement | Source |
|---|---|---|
| **TS-1** | Tools per dispatch — minimum-privilege: verifiers Read/Glob/Grep/Bash; content agents Read/Write/Edit; Builder full set | every agents/*.md frontmatter |
| **TS-2** | Runtime host enum: `windmill | anthropic-sdk | netlify-fn | vapi` — REFUSE if "spec" or "TBD" | SYSTEM-PROMPT-v1.md:80 |
| **TS-3** | Runtime host priority (REVISED 2026-05-02): scheduled-tasks > Netlify > Windmill > SDK > Vapi; n8n DEPRECATED | rule_agent_build_prompt_process.md |
| **TS-4** | Doppler-first: query `doppler secrets get ... -p crg-site -c prd --plain` BEFORE asking Marc for any credential | rule_query_doppler_first.md |
| **TS-5** | Levite owns ALL key rotation; orchestrator dispatches, never drives manually | rule_rotation_is_levites_job.md |
| **TS-6** | `agentGuard(tier, name)` MUST be called at function entry; fail-closed; Levite is only ALWAYS_ON | AGENT-WORKFLOW-ARCHITECTURE.md:46-47 |
| **TS-7** | Habakkuk pre-build harness MANDATORY: `bash scripts/qa/habakkuk-pre-build.sh --pr <n>`; verdict JSON pasted into PR body | BUILDER-DISPATCH-TEMPLATE.md:42-58 |
| **TS-8** | Bio-research tools (chembl, biorxiv, c-trials), Perplexity, WebSearch required for domain-expert agents (Vitalis) | BEZALEL-DISPATCH:94-98 |

### 2.3 Model routing (combined: ~12 reqs)

| ID | Requirement | Source |
|---|---|---|
| **MR-1** | NEVER Haiku — not for research, not for "quick", not to save cost | rule_model_selection.md |
| **MR-2** | NEVER GPT-lite (gpt-3.5, gpt-4o-mini) | rule_model_selection.md |
| **MR-3** | Default: claude-sonnet-4-6 (general agents, voice, content) | every agents/*.md frontmatter |
| **MR-4** | Opus 4.7: Daniel (research), Samuel (eval), Karis (review), KRITE (upgraded from Haiku 2026-04-25), Apollos critic, strategic analysis | EVALUATION-GRADING-FRAMEWORK-v1.md:18-21 |
| **MR-5** | Daniel must include Model Recommendation axis in every research brief | rule_model_selection.md:11 |
| **MR-6** | Every Agent tool call: explicit subagent_type AND model — no inheritance | rule_subagent_routing.md |
| **MR-7** | Use full model ID always: `claude-sonnet-4-6`, `claude-opus-4-7` (no aliases) | rule_model_selection.md:31 |
| **MR-8** | KRITE bias mitigations: independent axis scoring, randomized order, different model from build agent | BUILD-AGENT-PLAN.json:301-305 |

### 2.4 Research rules (combined: ~12 reqs)

| ID | Requirement | Source |
|---|---|---|
| **RR-1** | Phase 1 of every build = identify industry winners + their templates → adapt | rule_research_first_build_process.md |
| **RR-2** | Daniel/Perplexity sonar-pro for research; T1 citations required; refuse if no T1 found | SYSTEM-PROMPT-v1.md:96 |
| **RR-3** | T1-T4 knowledge tier required on every claim: T1=canonical (RFC/FDA/NEJM/working code/live curl), T2=practitioner consensus, T3=community/edge, T4=synthesis | doctrine_knowledge_tiers.md, anti-drift-block.js:55-60 |
| **RR-4** | Untiered claims FORBIDDEN in strategic outputs; KRITE research axis hard-fails on untiered | SYSTEM-PROMPT-v2.md:203 |
| **RR-5** | Vendor-docs-first: every vendor research dispatch checks vendor's docs/cookbook/SDK first | feedback_vendor_docs_first_research_doctrine.md |
| **RR-6** | Daniel research-cache: `/mnt/memory/daniel-research-cache/queries/`, 7-day re-use, 25KB/file, 30-day prune | daniel.md:67-72 |
| **RR-7** | Super-agent built from 5-10 named source voices; ~60% OG / ~40% new-school; persona blend with attribution | SUPER-AGENT-BUILD-PHILOSOPHY-v1.md:139-145 |
| **RR-8** | Vitalis T1 = NEJM/Lancet/PubMed/FDA/ClinicalTrials.gov/MEDLINE-indexed only | BEZALEL-DISPATCH:62 |

### 2.5 Memory + self-learning (combined: ~15 reqs)

| ID | Requirement | Source |
|---|---|---|
| **ML-1** | Self-improvement memstore: name = `<agent>-self-improvement`; mount = `/mnt/memory/<agent>-self-improvement/`; registry blob key = `<agent>.memstore_self_improvement_id` | AGENT-SELF-IMPROVEMENT-FRAMEWORK.md:166-180 |
| **ML-2** | 6-file SI memstore schema: marc-decisions / reference-examples / failure-modes (READ-ONLY) + self-critique-log / voice-evolution / prompt-proposals (WRITE-OK) | agent-self-improvement-prompt-block.js:25-35 |
| **ML-3** | **PROPOSE-ONLY DOCTRINE**: agents may write to /prompt-proposals.md; MUST NEVER silently rewrite their own system prompt; KRITE/Marc gate the merge; refuse any in-session bypass | AGENT-SELF-IMPROVEMENT-FRAMEWORK.md:184-193 |
| **ML-4** | Hook 4 = failure-mode trigger on Marc reject → `{what_went_wrong, what_to_do_differently, pattern_name}`; pattern_name appearing 3+ times = systemic drift | AGENT-FEEDBACK-API.md:21-77 |
| **ML-5** | Reference-examples top-K = 5; sort: rating desc → timestamp desc; rating < 4 = no-op | AGENT-FEEDBACK-API.md:117-120 |
| **ML-6** | Karis verdict-history memstore: `/mnt/memory/karis-verdict-history/<YYYY-MM-DD>.json`, append-only, 30-day retention, INDEX.md tracks latest | karis.md:42-69 |
| **ML-7** | Stale-Memory rule: doc >30d = re-verify before reliance; runtime claims >24h = re-verify (v2 stricter) | anti-drift-block.js:66; Doctrine v2 R5 |
| **ML-8** | Inner self-learning loop: KRITE traces → Samuel weekly digest → ≤3 prompt-edit proposals → Marc ratifies → Build Agent rolls out → KRITE re-evaluates | EVALUATION-GRADING-FRAMEWORK-v1.md:236-263 |
| **ML-9** | Outer loop (Q3 2026 kickoff) requires ≥6-12 weeks of clean inner-loop substrate first | SELF-LEARNING-LOOP-v1.md:101-118 |
| **ML-10** | 4 Samuel retrain triggers: grade <target 3 weeks OR error 2× baseline OR >3 complaints/14d OR cost 1.5× baseline | EVALUATION-GRADING-FRAMEWORK-v1.md:178-185 |
| **ML-11** | Append-only learnings corpus pattern: agents read `reference_*_learnings.md` first on every spawn; new entries append-only, edits forbidden | BEZALEL-DISPATCH:166-170 |
| **ML-12** | `validateAgentName` regex: `/^[a-z][a-z0-9-]{1,40}$/` (kebab-case enforced) | AGENT-SELF-IMPROVEMENT-FRAMEWORK.md:179 |

### 2.6 Verification rules (combined: ~25 reqs)

| ID | Requirement | Source |
|---|---|---|
| **VR-1** | Gate D contract MANDATORY: `runtime_file_path, runtime_file_size_bytes, test_fire_command, test_fire_output_first_500_chars, langfuse_trace_id, krite_scores, krite_iterations, doctrine_refs_applied, marc_facing_summary` | BUILD-AGENT-PLAN.json:101-198 |
| **VR-2** | Gate output schema (v2): `{gate, status, runtime_id, trace_id, timestamp, evidence_paths}`; status PASS requires non-null runtime_id+trace_id+evidence_paths≥1 | gate-output-schema.json |
| **VR-3** | runtime_id format: `<type>:<id>` — 7 valid types (windmill, windmill-job, anthropic, langfuse, netlify, file, git) | runtime-verifier.js |
| **VR-4** | KRITE 5-axis: voice/compliance/research/tone/wku — threshold 0.80 per axis OR 85/100 + zero hard-fails | EVALUATION-GRADING-FRAMEWORK-v1.md:124-128 |
| **VR-5** | Karis 5 axes (constitutional/canon/wku/output/criteria) threshold 0.82 avg + ≥0.70 each; self-audit downgrade to INCONCLUSIVE if own rubric < 0.82 | karis.md:82-93 |
| **VR-6** | Habakkuk 6 axes (claim-vs-evidence/logic-gap/test-coverage/dependency-hallucination/doctrine-drift/internal-consistency); 100 base, critical -25 / major -10 / minor -3; pass score≥70 AND no critical | habakkuk-critic.js |
| **VR-7** | Habakkuk 9 deterministic patterns A-I (memory-vs-code drift, phantom env, cron-orphan, spec-arch mismatch, phantom integration, test-claim falseness, trace-placeholder lockout, PR-attestation falseness, anti-drift-block missing) | habakkuk-pattern-checks.js |
| **VR-8** | Pattern check FAIL-CLOSED: any check that cannot evaluate returns 'inconclusive' = REJECT | habakkuk-pattern-checks.js:32-35 |
| **VR-9** | Test-fire MANDATORY (Step 5): execute runtime ONCE; capture output ≥500 chars; capture Langfuse trace ID. NO BUILT without test-fire | OPERATING-MANUAL-v1.md:43-46 |
| **VR-10** | Gate F (runtime kill): 3 checks (config flag set; zero executions after disable; 24h idle-wait). Only Check 1 = PROVISIONALLY_KILLED | anti-drift-block.js:49-53 |
| **VR-11** | Gate G (Independent Validator): clean context, "you don't trust the Builder" framing; CONFIRMED/REFUTED/INCONCLUSIVE | rule_gate_g_independent_validator.md |
| **VR-12** | Gate G applies to: code builds, deploy/merge/ship, killed/disabled, set-up/configured/wired, fix-verification claims | rule_gate_g_independent_validator.md:27-32 |
| **VR-13** | Doctrine v2 R1: agent NOT deployed unless ONE of: Anthropic agent_id OR Windmill script GET 200 OR Netlify URL 200 OR commit SHA + deploy URL | Doctrine v2 §4 R1 |
| **VR-14** | Doctrine v2 R2: agent claimed LIVE must have Langfuse trace within 7 days; older = STALE | Doctrine v2 §4 R2 |
| **VR-15** | Doctrine v2 R3: self-verification INVALID; orchestrator self-grade = `shadow-<gate>`, never `<gate>` | Doctrine v2 §4 R3 |
| **VR-16** | Doctrine v2 R4: docs cannot be evidence; live tool call required | Doctrine v2 §4 R4 |
| **VR-17** | Doctrine v2 R10: `data/agents-registry.json` is single source of truth for "is X deployed" | Doctrine v2 §4 R10 |
| **VR-18** | KRITE iteration loop: 0 first / 1 re-fire with previous_critique / 2 stronger / 3 escalate to Marc with full trace. Max 3 iterations | OPERATING-MANUAL-v1.md:51-53 |
| **VR-19** | Habakkuk → KRITE → Karis → Marc — every handoff goes through tier gate | habakkuk-critic.js:18-22; karis.md:13 |
| **VR-20** | Karis runtime invariants per `karis-test-plans.json`: 5+ standard checks per artifact | karis-test-plans.json:11-100 |

### 2.7 Best practices (combined: ~30 reqs)

| ID | Requirement | Source |
|---|---|---|
| **BX-1** | Canonical spec: every rule/rubric/persona = ONE source-of-truth file; SSOT propagation via imports | rule_anti_drift_1_canonical_spec.md |
| **BX-2** | Instruction hierarchy: 5-layer system prompts (identity > constraints > tools > context > task) | rule_anti_drift_2_instruction_hierarchy.md |
| **BX-3** | Orchestration not execution: >3 file reads OR >5 sequential calls = delegate | rule_orchestration_not_execution.md |
| **BX-4** | Independent tasks fire in parallel (multiple Agent calls per turn) | rule_orchestration_not_execution.md |
| **BX-5** | DOSSIER.md 5-layer scaffold: biblical archetype → personality/voice → hiring memo → WKU → operating profile | AGENT-WORKFLOW-ARCHITECTURE.md:50-52 |
| **BX-6** | Decision Rights Matrix tiers: Green (autonomy) / Yellow (ships, Marc reviews after) / Red (proposal only) / Black (KRITE+Marc, brand-critical) | AGENT-OPERATING-MODEL.md:62-68 |
| **BX-7** | Tier upgrade requires 4 consecutive weeks >90% Judge/Samuel scores; Marc approves; Monday | AGENT-OPERATING-MODEL.md:108 |
| **BX-8** | XML system prompt structure: `<role>`, `<scope>`, `<doctrine_refs>`, `<intake_schema>`, `<process>`, `<output_format>`, `<refusal_modes>`, `<wku_pillar>`, `<anti_drift_hardening>` | SYSTEM-PROMPT-v2.md |
| **BX-9** | "No optional behavior": every conditional exhaustive (if-then-else with all branches); no "you may" / "feel free to"; use ALWAYS, NEVER, REFUSE IF, MUST RETURN | BUILD-AGENT-RESEARCH:189-191 |
| **BX-10** | Builder works in **isolated git worktree** (`isolation: worktree`); cannot inline-edit production | BEZALEL-DISPATCH:225 |
| **BX-11** | Versioning required: every working app versioned on every significant change | rule_anti_drift_7_version_and_github_gate.md |
| **BX-12** | All deploys through GitHub PR; never CLI netlify deploy | rule_anti_drift_7_version_and_github_gate.md:34-39 |
| **BX-13** | Every artifact = git ref on GitHub before going live | rule_github_version_control_source_of_truth.md |
| **BX-14** | AI-time calibration table — never consultant-time: validators 1-3 min, tiny patch 2-3 min, single migration 8-15 min, multi-file 12-22 min, huge sprint 17-30 min | feedback_time_estimation_calibration.md |
| **BX-15** | Handoff bus pattern: Producer `bus.emit(eventName, "producer", payload)` only; never direct enqueue. Router owns queue. Consumer polls own inbox. | AGENT-HANDOFF-PATTERN.md:21-30 |
| **BX-16** | Every handoff goes through KRITE (yellow) or Samuel (red) before Marc; no agent emits to Marc as primary except escalations | AGENT-HANDOFF-PATTERN.md:30 |
| **BX-17** | Per-agent rubric in `agent-self-critique-rubrics.js`: source_tier_quality, research_depth, wku_synthesis, evidence_specificity, model_recommendation | agent-self-critique-rubrics.js:88-92 |
| **BX-18** | Three drift-prevention pillars (academic basis): Instruction Hierarchy (Wallace 2024 arxiv 2404.13208) + Constitutional AI (Bai 2022 = KRITE) + XML-tag prompting | BUILD-AGENT-RESEARCH:127-138 |
| **BX-19** | KRITE bias mitigations (Zheng 2023): position bias (randomize axis order), verbosity bias (score axes independently), self-enhancement bias (different model from builder) | BUILD-AGENT-RESEARCH:143 |

### 2.8 Output + format (combined: ~15 reqs)

| ID | Requirement | Source |
|---|---|---|
| **OF-1** | Marc-facing docs ship as `.docx` (Marc opens .md raw); converter at `workspace/scripts/md-to-docx.sh` | rule_marc_facing_docs_format.md |
| **OF-2** | Plain English leads every Marc-facing message; no raw JSON, SHAs, log dumps in body; technical → .docx links/foldable sections | feedback_communication_style.md |
| **OF-3** | Builder OUTPUT: STRICT JSON Gate D contract; no preamble like "I'll get started"; no markdown fences | SYSTEM-PROMPT-v1.md:136 |
| **OF-4** | When stakes high, agent output structure: 1. Recommendation (1 sentence) / 2. Wisdom (principle) / 3. Knowledge (data + source) / 4. Understanding (Marc-specific application) | SUPER-AGENT-BUILD-PHILOSOPHY-v1.md:120-128 |
| **OF-5** | NEVER infer time-of-day from session flow; run `date` first; Marc TZ = America/Toronto | feedback_no_time_of_day_assumptions.md |
| **OF-6** | Marc-acknowledgment convention: silence = approved; question = clarification | feedback_marc_acknowledgment_rule.md |
| **OF-7** | XML decomposition emit FIRST when dispatching 3+ workers strategically | doctrine_xml_task_decomposition.md |
| **OF-8** | Strategic dispatches: explicit `subagent_type` and `model` per call | rule_subagent_routing.md |

### 2.9 Anti-drift / anti-patterns (combined: ~30 reqs)

| ID | Requirement | Source |
|---|---|---|
| **AD-1** | **Anti-Drift Block v2 (9 rules) MUST be embedded VERBATIM** in every CRG agent system prompt | anti-drift-block.js |
| **AD-2** | 10 canonical markers (byte-for-byte): EVIDENCE-OR-INCOMPLETE / GATE F / T1–T4 / NO INLINE EDITS / CONTRADICTION / STALE-MEMORY / INCOMPLETE-OVER-FAKED / PLAIN-ENGLISH MARC-FACING / SELF-DOUBT AS FEATURE / PRECEDENCE | anti-drift-block.js:80-91 |
| **AD-3** | Theater pattern named (April 22): "spec declared live without runtime evidence" — Build Agent exists to prevent | feedback_theater_pattern_named.md |
| **AD-4** | Gate-pass language BANNED without verdict file: "KRITE PASS", "Karis verified", "Validator CONFIRMED", "Build Agent dispatched" | feedback_gate_pass_language_banned.md |
| **AD-5** | Banned-without-evidence tokens: PASS / LIVE / DEPLOYED / BUILT / SHIPPED — replacements VERIFIED `<file>` / OBSERVED `<ts>` / DEPLOYED `<runtime>:<id>` / BUILT `(<file>:<lines>, <commit>)` / INCOMPLETE | enforce-config.json |
| **AD-6** | INCOMPLETE-OVER-FAKED: most-punished error. STOP, don't fabricate, label INCOMPLETE, state blocker, exit | anti-drift-block.js:68 |
| **AD-7** | DO NOT BUILD: marketing copy (Apollos), email drips (Lydia), bookkeeping (Joseph), content posts, multi-tenant code paths, sales-theater surfaces | SYSTEM-PROMPT-v1.md:46-51 |
| **AD-8** | Hard refusals — NEVER mark BUILT/LIVE without test-fire; NEVER improvise scope beyond intake; NEVER skip research-first; NEVER skip KRITE; NEVER write .md spec and call it a build | SYSTEM-PROMPT-v1.md:30-32 |
| **AD-9** | KRITE Voice axis hard-fails: generic "AI-assistant" tone, hype-broadcaster, unauthorized emoji, sales-theater language ("game-changing", "revolutionary", "unprecedented") | EVALUATION-GRADING-FRAMEWORK-v1.md:38-43 |
| **AD-10** | Apollos forbidden patterns (PATCH-G2): em-dash runs, "Indeed,", "Moreover,", "Furthermore,", "dive into", "delve into", "landscape of", "in today's fast-paced/ever-changing/modern/digital" | apollos.md:174-176 |
| **AD-11** | 6 super-agent failure modes: just-clone-Cardone (single source), 10-voices-no-convergence, all-OGs (1995 advice), all-new-school (no spine), no-citations, no-Marc-adaptation | SUPER-AGENT-BUILD-PHILOSOPHY-v1.md:165-185 |
| **AD-12** | Aspirational "X is dead" treated as verified-decommissioned without checking migration doc | feedback_verify_migration_before_kill.md |
| **AD-13** | Asking Marc credentials Doppler/TOOLS.md/.env already has = violation | rule_query_doppler_first.md |
| **AD-14** | Driving vendor dashboards manually for rotation = violation | rule_rotation_is_levites_job.md |
| **AD-15** | "general-purpose" with model unspecified = silent inheritance / non-auditable | rule_subagent_routing.md:54 |
| **AD-16** | Confirming things Marc has already given clear authority on = autonomy violation | feedback_autonomous_decision_authority.md |
| **AD-17** | Habakkuk Pattern A — memory-cited path must exist in `git ls-tree -r origin/main`. Mismatched = violation | habakkuk-pattern-checks.js:44-104 |
| **AD-18** | Habakkuk Pattern E — URL string with no fetch()/axios() exercising it = violation | BUILDER-DISPATCH-TEMPLATE.md:78 |

---

## §3. BUILDER COMPLIANCE MAP

For each doctrine requirement: APPLIES status, IMPLEMENTATION state, evidence path, required patch.

### 3.1 ENFORCED in Builder (ship-quality)

| Req | Status | Evidence |
|---|---|---|
| BP-5 (cost cap) | ENFORCED | `BUILD-AGENT-PLAN.json:18-20` referenced; `KRITE_PASS_THRESHOLD=0.80, KRITE_MAX_ITERATIONS=3` constants `main.py:101-102` |
| MR-3 (Sonnet default) | ENFORCED | `ANTHROPIC_SONNET="claude-sonnet-4-6"` `main.py:100`; used `1041, 1751, 1987` |
| MR-4 (Opus for review) | ENFORCED | `ANTHROPIC_OPUS="claude-opus-4-7"` `main.py:99`; used `691` (`krite_review`) |
| MR-1 (no Haiku) | ENFORCED in build paths | No Haiku model id anywhere in `main.py`; gen prompts forbid in 122, 210 |
| AD-6 (INCOMPLETE-OVER-FAKED implicit) | ENFORCED | `HONEST-FAILED` at 8 sites: `1499, 1563, 1707, 1769, 1826, 2015, 2136, 2181` |
| BP-1 (7-step pipeline core) | ENFORCED | Steps 1, 2, 4, 5, 6, 7 all have code paths in `main.py:1551-2318` |
| OF-3 (Gate D contract format) | ENFORCED | `main.py:2290-2317` returns structured JSON |
| OF-2 (plain-English summary) | ENFORCED in own output | `marc_summary()` `main.py:1454-1545` |
| VR-1 (Gate D fields) | ENFORCED | All required fields in final response |
| VR-9 (test-fire mandatory) | ENFORCED for Windmill | `design_functional_test()` 1003-1077; `run_functional_test()` 1080-1172 |
| VR-18 (3-iteration KRITE loop) | ENFORCED | `main.py:1666-1683` |

### 3.2 PARTIAL (works for some cases, gaps remain)

| Req | Status | Evidence | Gap |
|---|---|---|---|
| BP-2 v2 pipeline | PARTIAL | Builder pre-dates v2 doctrine; doesn't enforce feature-branch / commit-with-evidence flow | Add `bash scripts/qa/enforce.sh validate-gate` step before BUILT |
| RR-1 (research-first) | PARTIAL | `daniel_research()` defined but **NEVER CALLED** in `main()` — dead code | Wire into Step 3 when canon is empty |
| AD-5 (banned tokens) | PARTIAL | Builder doesn't grep its own output for banned tokens | Run `claim-parser.js` over `marc_facing_summary` before return |
| ML-7 (stale memory) | PARTIAL | `load_doctrine_blocks()` doesn't check file mtime | Add 24h re-verify check on doctrine refs |
| VR-13 (R1 runtime ID) | PARTIAL | Builder produces job_id but doesn't validate it via `runtime-verifier.js` | Run verifier on own output before BUILT |
| BX-13 (GitHub source-of-truth) | PARTIAL | Builder writes to Windmill; orchestrator commits separately | Builder must invoke git commit OR return content for orchestrator to commit |
| TS-2 (runtime host enum) | PARTIAL | Validates `windmill | anthropic-sdk | netlify-fn | vapi`, but doesn't enforce **scheduled-tasks > Netlify > Windmill > SDK > Vapi** priority (TS-3) | Add priority check |

### 3.3 REFERENCED ONLY (in docstring/instruction, NOT enforced as validation)

| Req | Status | Evidence | Gap |
|---|---|---|---|
| AD-1 (anti-drift block VERBATIM) | REFERENCED only | Generated agents told to include via gen prompt; **not validated** post-generation | Add `verifySystemPromptContainsBlock()` check (helper exists at `_lib/anti-drift-block.js`) |
| AD-2 (10 markers) | REFERENCED only | No grep on generated code | Same as AD-1 — use helper |
| RR-3 (T1-T4 tiering) | REFERENCED only | KRITE rubric mentions; no hard validation | Add T1 citation count check on generated code |
| BX-1 (WKU framing in built agents) | REFERENCED only | Lines 141-144, 240-243 instruct; no grep on `generated` for "WKU" / "Wisdom" / "Proverbs" | Add `if not any(kw in generated for kw in ("WKU", "Wisdom", "Proverbs 24:3"))` validation |
| BX-5 (DOSSIER 5-layer) | REFERENCED only | No structural check on built agents | Add validation: archetype + personality + hiring + WKU + profile |
| ML-3 (PROPOSE-ONLY) | REFERENCED only (Apollos has it) | Builder doesn't ensure built agents include the propose-only block | Add `agent-self-improvement-prompt-block.js` import to gen prompt |
| TS-7 (Habakkuk pre-build) | REFERENCED only | Builder doesn't run Habakkuk on its own output | Run `habakkuk-pre-build.sh` against generated code |

### 3.4 MISSING (no doctrine enforcement, no code path)

| Req | Status | Gap | Severity |
|---|---|---|---|
| **CRITICAL — Hardcoded URL drift** | MISSING | Builder calls `https://app.windmill.dev/api/w/crg/...` but actual is `localhost:8000/api/w/admin/...`. Builder cannot run end-to-end against current infra | **P0 BLOCKER** |
| **CRITICAL — namespace drift** | MISSING | Builder writes to `u/marc/<agent_name>` but actual workspace user is `u/admin/...`. Created scripts won't deploy | **P0 BLOCKER** |
| **CRITICAL — KRITE call points to fictional path** | MISSING | Builder calls `u/marc/krite-agent-v1` (line 781) — not deployed; KRITE-as-content-gate is at `u/admin/krite_quality_standards_v2` (different agent, different purpose) | **P0 BLOCKER** |
| RR-1 wiring | MISSING | `daniel_research()` dead code | P1 |
| VR-7 (Habakkuk 9 patterns) integration | MISSING | Builder doesn't invoke Habakkuk patterns; built agents bypass | P1 |
| BX-13 git commit | MISSING | No `subprocess.run(['git', 'commit'])` anywhere | P1 |
| ML-1 SI memstore bootstrap | MISSING | Builder doesn't create `<agent>-self-improvement` memstore | P1 |
| ML-4 failure-mode trigger endpoint generation | MISSING | Builder doesn't generate `/api/<agent>-failure-mode-trigger` Netlify function | P2 |
| VR-17 (R10 registry append) | MISSING | Builder doesn't append to `data/agents-registry.json` | P1 |
| BX-17 rubric integration | MISSING | Built agents don't get a `agents/rubrics/<agent>.json` entry | P2 |
| OF-7 XML decomposition | MISSING | Builder doesn't produce decomposition for sub-Builder dispatches | P2 |
| AD-9 KRITE Voice hard-fails | MISSING | KRITE rubric doesn't grep generated text for sales-theater phrases | P1 |
| AD-10 Apollos forbidden patterns | MISSING | Builder doesn't enforce em-dash/template-language ban for content agents | P2 |
| BX-15 handoff bus pattern | MISSING | Built agents don't use bus.emit pattern automatically | P2 |
| TS-6 agentGuard | MISSING | Built agents not wrapped in `agentGuard(tier, name)` | P1 |
| BX-7 tier promotion gate | MISSING | Builder ships agents at unspecified tier; doesn't generate scorecard schema | P2 |
| ML-9 outer loop substrate | DOES_NOT_APPLY | Outer loop is fleet-level (Q3 2026); not Builder's responsibility | N/A |

### 3.5 Hardcoded Builder paths that need correction

| Line | Current (broken) | Should be |
|---|---|---|
| 956 | `https://app.windmill.dev/api/w/crg/scripts/list` | `http://localhost:8000/api/w/admin/scripts/list` (or env-driven) |
| 781 | `https://app.windmill.dev/api/w/crg/jobs/run/p/u/marc/krite-agent-v1` | `http://localhost:8000/api/w/admin/jobs/run/p/u/admin/krite_quality_standards_v2` (if KRITE is to be real Windmill agent) |
| 2150 | `https://app.windmill.dev/api/w/crg/scripts/create` with path `u/marc/<name>` | `http://localhost:8000/api/w/admin/scripts/create` with path `u/admin/<name>` |
| 1099 | `https://app.windmill.dev/api/w/crg/jobs/run/p/<path>` | `http://localhost:8000/api/w/admin/jobs/run/p/<path>` |

All four MUST be patched OR moved to environment variables before Builder is functional.

---

## §4. BUILDER PATCH PLAN

Prioritized. Total estimated AI-time per Doctrine v2 calibration table.

### P0 — BLOCKERS (Builder cannot function until these land)

| # | Patch | Approach | Estimated AI-time |
|---|---|---|---|
| P0.1 | Replace hardcoded `app.windmill.dev/api/w/crg/...` with env-driven URL via `wmill.get_variable("u/admin/WINDMILL_BASE_URL")` (default `http://localhost:8000`) | Find/replace 4 sites; add hydration in Step 1 | 5-8 min |
| P0.2 | Replace hardcoded `u/marc/` namespace with workspace-derived `u/<user>/`; pull from a new `BUILD_AGENT_USER_NAMESPACE` Windmill var (default `admin`) | Find/replace; same pattern as P0.1 | 5-8 min |
| P0.3 | Fix KRITE deployed-agent path: either to actual `u/admin/krite_quality_standards_v2` OR remove deployed-KRITE call and rely on inline KRITE only (since KRITE-as-build-time-reviewer is FICTIONAL per audit) | Cleanest: remove `krite_review_via_deployed_agent()` call site; keep only inline `krite_review()` | 8-12 min |
| P0.4 | Create the 5 `u/marc/*` Windmill variables from Doppler (or rename to `u/admin/*` if P0.2 lands) | Doppler-fetch + Windmill API POST x5; verify each | 5-8 min |

**P0 total:** ~25-40 min

### P1 — DOCTRINE COMPLIANCE (required for Builder to pass enforcement on its OWN output)

| # | Patch | Approach | Estimated AI-time |
|---|---|---|---|
| P1.1 | Wire `daniel_research()` into Step 3 of `main()` when `len(intake.canon_refs) < 2` or canon manifest has gaps | Insert call in `main.py` between intake validation and code-gen | 10-15 min |
| P1.2 | Add post-generation validation: `verifySystemPromptContainsBlock(generated)` using helper from `_lib/anti-drift-block.js` (port to Python) | Implement Python equivalent of marker check; add to validation gates | 12-18 min |
| P1.3 | Add WKU validation: `if not any(kw in generated for kw in ("WKU", "Wisdom", "Proverbs 24:3")): refuse` | Single grep check in validation phase | 3-5 min |
| P1.4 | REFUSE on missing doctrine refs: if `load_doctrine_blocks()` returns any `found: false`, return REFUSED with `marc_action_required` | Insert refusal branch after manifest build | 5-8 min |
| P1.5 | Run Habakkuk patterns A-I against generated code via `habakkuk-pre-build.sh`; REFUSE on inconclusive/REJECT verdict | Subprocess call; parse JSON verdict | 12-18 min |
| P1.6 | Add git commit step: Builder writes generated code to a feature branch in cornerstoneregroup-site (or workspace) and commits with evidence-rich message | Add `subprocess.run(['git', 'add', ...]); subprocess.run(['git', 'commit', '-m', ...])` at Step 7 | 12-18 min |
| P1.7 | Append to `data/agents-registry.json` after BUILT — entry per Doctrine v2 R10 | JSON read/append/write in Step 7 | 5-10 min |
| P1.8 | Wrap built agents in `agentGuard(tier, name)`: inject `agentGuard()` call into generated code based on intake `tier` field | Modify `GEN_SYSTEM_PROMPT` instructions + post-validate | 8-12 min |
| P1.9 | Add `claim-parser.js` self-check: scan `marc_facing_summary` for banned tokens before return; downgrade to INCOMPLETE if found | Subprocess call to claim-parser; check exit code | 5-8 min |
| P1.10 | KRITE Voice hard-fail enforcement: add explicit grep for sales-theater phrases ("game-changing", "revolutionary", "unprecedented") to KRITE rubric; auto-fail on hit | Add to `KRITE_RUBRIC` constant | 3-5 min |

**P1 total:** ~75-115 min (single multi-file retrofit)

### P2 — DOCTRINE COMPLETENESS (improves built agents to be doctrine-compliant)

| # | Patch | Approach | Estimated AI-time |
|---|---|---|---|
| P2.1 | SI memstore bootstrap: every built agent gets `<agent>-self-improvement` memstore created via Anthropic Managed Agents API; registry blob updated | Use `agent-self-improvement.js` helpers | 18-25 min |
| P2.2 | Generate `agents/rubrics/<agent>.json` per built agent (default rubric template + agent-specific axes from intake) | Template fill + write | 8-12 min |
| P2.3 | Generate `agents/scorecards/<agent>.json` template entry | Same pattern | 5-8 min |
| P2.4 | Generate `/api/<agent>-failure-mode-trigger` Netlify function stub for Marc-feedback hook | Code-gen Netlify fn | 12-18 min |
| P2.5 | Generate `/api/<agent>-reference-curate` Netlify function stub | Same pattern | 8-12 min |
| P2.6 | Apollos-specific: enforce forbidden-pattern matrix (em-dash, "Indeed," etc.) in content-agent generation | Add to `APOLLOS_FORBIDDEN_PATTERNS` post-validation | 8-12 min |
| P2.7 | DOSSIER.md 5-layer scaffold validation on built agents: archetype + personality + hiring memo + WKU + profile present | Structured grep | 8-12 min |
| P2.8 | XML decomposition emit for sub-Builder dispatches (3+ workers) | Conditional block in main() | 5-8 min |
| P2.9 | Handoff bus pattern injection for built agents: `bus.emit(eventName, "producer", payload)` template | Boilerplate injection | 5-8 min |
| P2.10 | Tier-aware Decision Rights wrapping: built agents get correct `agentGuard(tier)` based on intake | Refinement of P1.8 | 5-8 min |

**P2 total:** ~85-125 min (huge sprint)

### P3 — LOCKING DOCTRINE (one-time hardening)

- Tag deprecated `BUILD-AGENT-OPERATING-MANUAL-v1.md` and `BUILD-AGENT-SYSTEM-PROMPT-v1.md` with `**DEPRECATED — superseded by 2026-05-04-CRG-BUILD-DOCTRINE-v2-CORRECTED.md**` at top-of-file
- Update placeholder agent specs (samuel.md, nehemiah.md, eod.md) flagged "PARALLEL — being migrated"
- Fill the 4 unread foundational docs (CRG-OPERATING-MANUAL.md 35KB, CRG-BUSINESS-ARCHITECTURE.md 42KB, NEXT-PROMPT-krite-agent-v1.md, AGENT-FLEET-AUDIT-2026-04-25.md)

### Total estimated patch effort

- **P0 (blockers):** ~30-40 min agent-time
- **P1 (doctrine compliance):** ~75-115 min
- **P2 (doctrine completeness):** ~85-125 min
- **P3 (doctrine hardening):** ~30-45 min

**Grand total:** ~220-325 min agent-time across 4 sprints. Plus per-Doctrine-v2-§9 amendment: each sprint requires Marc explicit approval + Habakkuk pre-build + commit.

### Recommended sprint ordering

1. **Sprint 1 (P0 only):** Builder becomes runnable against current infra. ~40 min. After this sprint, Builder can complete an end-to-end self-test with `u/marc/*` variables created, Daniel research live, Langfuse trace produced. Then re-run enforcement → expect VERIFIED.
2. **Sprint 2 (P1.1-P1.5):** Builder enforces doctrine on its own output. ~50 min.
3. **Sprint 3 (P1.6-P1.10):** Git + registry + claim-parser + KRITE hard-fails. ~30 min.
4. **Sprint 4 (P2):** Built agents are doctrine-compliant out of the box. ~120 min.
5. **Sprint 5 (P3):** Doctrine hardening. ~45 min.

---

## §5. FINAL STATUS

`BUILDER_STATUS = INCOMPLETE`

**Per Marc's specified completion criteria:**

| Criterion | Status |
|---|---|
| Credentials work | INCOMPLETE — Doppler keys verified accessible, but Windmill `u/marc/*` variables not yet created (function-quoting issue, easily fixable) |
| Self-test reaches LLM call | INCOMPLETE — Builder failed at hydration on first invoke; pending var creation |
| Langfuse trace exists | INCOMPLETE — pending successful invoke |
| Enforcement validates runtime evidence | PARTIAL — Builder deployment runtime_id CONFIRMED; trace_id null; Rule 1 satisfied via windmill-job; honest report says PARTIAL |
| Builder system behavior includes recovered doctrine | INCOMPLETE — see §3.4: 11 MISSING doctrine items (P0+P1 critical) |
| Missing doctrine items implemented or marked INCOMPLETE | DONE — explicitly mapped in §3.4 with severity, all flagged INCOMPLETE |

**Builder is INCOMPLETE on 5 of 6 Marc criteria.** 1 criterion done (this synthesis is the explicit-marking-INCOMPLETE deliverable).

**Confidence note (Self-Doubt rule):** This synthesis was produced from doc/code reads, not live runtime checks for every claim. The 4 critical hardcoded path mismatches (cloud→localhost, marc→admin namespace, fictional KRITE path) are line-cited from `main.py` audit but I have not run a live test invocation to prove Builder fails at those exact lines. A P0 sprint dispatch would either confirm or refute via live tool calls. Recommend Marc validates P0 priority before greenlighting the full patch sequence.

---

*End of synthesis.*

*Filed 2026-05-05 02:30 EDT.*
*Authority: 4 parallel Opus 4.7 audits — Memory (a96d258c), Workspace 01-CRG (a29cb7ff), Repo+Skills (a76779bc), Builder main.py (a2550000).*
*Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>*
