# Habakkuk v1

> *"Watch and observe! For I am doing something in your day that you would not believe even if it were told to you."* — Habakkuk 1:5
>
> A CRG-internal multi-agent code-review service. The architectural fix
> for ultrareview's deterministic Dedupe-stage crash on
> `feat/garvis-pulse-tiles` (2026-05-01).

## Why this exists

Anthropic's `/ultrareview` crashed twice on the same CRG branch on
2026-05-01, deterministically at the Dedupe stage. The failure mode:
shoving 24 raw findings from many parallel agents into a single
consolidator LLM call blows the context window when any single PR is
non-trivial.

**Habakkuk's architectural fix:** Dedupe is *structural* — per-file
finding-IDs collide automatically via a deterministic key
`(file, line_start, claim_hash)`. No 24-into-one LLM consolidation.
Every stage has a hard token budget that is asserted in code before any
network call.

## Pipeline

```
                      Habakkuk v1 — 6-stage pipeline
                      =================================

  +---------+         (PR metadata only — no diff content)
  |  PLAN   |  Opus 4.7   →  plan.md
  +---------+
       │
       ▼
  +-----------+       (pure Python, no LLM, lifted from Qodo PR-Agent)
  | COMPRESS  |  →  bundles/<area>.diff   (≤ 24K tokens each, hard cap)
  +-----------+
       │
       ▼
  +-------------+     (6 parallel Sonnet 4.6 sub-agents — security, perf,
  |  FAN-OUT    |      ux-a11y, data-integrity, api-contracts, tests-coverage)
  +-------------+  →  findings/<area>.json
       │
       ▼
  +---------+         (Sonnet 4.6 — independent verification per finding;
  | VERIFY  |          loads actual repo lines, not the diff bundle)
  +---------+      →  verified.json   (drop conf < 0.7 + inconclusive)
       │
       ▼
  +--------+          (Opus 4.7 — STRUCTURAL dedupe (Python), then exec-summary)
  |  RANK  |       →  ranked.json
  +--------+
       │
       ▼
  +---------+         (Sonnet 4.6 — humanizes claims into Marc-facing brief)
  | PRESENT |     →  brief.md  +  brief.docx
  +---------+
```

Every stage reads/writes from `~/.openclaw/habakkuk/runs/<run-id>/` —
zero in-memory hand-offs. Restartable from any stage.

## Hard constraints (violation = build failure)

- Prompt token cap: 32K (asserted in code before every LLM call).
- Bundle token cap: 24K per area (COMPRESS hard-fails on overflow).
- Snippet cap: 60 tokens (~240 chars) inside finding records.
- 7-rule Anti-Drift block + WKU framework in EVERY agent prompt.
- Read-only — Habakkuk produces findings, never writes code or pushes
  commits (per Cognition Devin doctrine).
- Confidence < 0.7 → dropped at VERIFY.
- Memory hand-off — no inline data passing between stages.

## Runtime decisions

| Question | Decision | Why |
|---|---|---|
| Runtime host | Anthropic SDK (Python) | Windmill not installed locally on Marc's mac; SDK is the second-priority option per CRG runtime doctrine |
| Parallelism | `concurrent.futures.ThreadPoolExecutor` (6 workers) | SDK calls release GIL during I/O; threads parallelize cleanly |
| Model — PLAN | `claude-opus-4-7` | Highest-leverage decision in pipeline (no diff yet, just metadata) |
| Model — FAN-OUT | `claude-sonnet-4-6` | Default CRG workhorse; 6 parallel calls |
| Model — VERIFY | `claude-sonnet-4-6` | One call per finding; cost matters |
| Model — RANK | `claude-opus-4-7` | Final exec-summary — Marc reads this |
| Model — PRESENT | `claude-sonnet-4-6` | Reformatting; doesn't need Opus |
| Tokenizer | char/4 estimate | Conservative; overcounts ~10% which is what we want |
| Observability | Langfuse if configured + always-on local JSONL | Langfuse via Doppler keys; degrades gracefully |
| Output | `.docx` via `workspace/scripts/md-to-docx.sh` | Per CRG doc-format rule |

## Invocation

```bash
# From any git repo:
~/.openclaw/workspace/habakkuk/bin/habakkuk \
    --branch feat/garvis-pulse-tiles \
    --base main \
    --repo /path/to/repo
```

`--resume-run-dir <path>` skips stages whose outputs already exist on
disk — useful when iterating on RANK/PRESENT prompt without rerunning
fan-out.

Outputs land in `~/.openclaw/habakkuk/runs/<timestamp>-<branch>-<sha>/`:

- `plan.md` — Opus's investigation plan
- `bundles/<area>.diff` — compressed per-area diffs
- `findings/<area>.json` — raw fan-out output
- `verified.json` — survivors after VERIFY
- `ranked.json` — deduped + scored
- `brief.md` and `brief.docx` — Marc-facing brief
- `telemetry.jsonl` — local trace log (always written)
- `run.meta.json` — full per-stage metadata

## Attribution (lifted templates)

- **PR Compression Strategy** — verbatim port from Qodo PR-Agent
  (https://qodo-merge-docs.qodo.ai/core-abilities/compression_strategy/).
  See `habakkuk/stages/compress.py`. Original is MIT-licensed
  (`qodo-ai/pr-agent`).
- **Three-stage Generate → Judge → Filter** — structural pattern from
  Atlassian Rovo Dev (Sonnet Judge replaces ModernBERT in v1; collect
  Marc's actions over time as fine-tune dataset for v2).
- **Orchestrator-worker + Memory hand-off** — Anthropic's multi-agent
  research system pattern
  (https://www.anthropic.com/engineering/multi-agent-research-system).
- **Confidence threshold (drop < 0.7)** — Greptile.

## Pre-Marc-run review path

Before any first run on Marc-facing branches:

1. **KRITE** — re-read every agent prompt for Anti-Drift + WKU + token
   compliance. KRITE rejects any prompt missing the block.
2. **Karis** — verdict pass on the prompt suite + sample run.
3. **Gate G** — independent Validator agent with clean context, told
   "you don't trust the Builder," confirms or refutes the test-run
   evidence (brief exists, prompts under cap, langfuse trace populated).

## Out of scope for v1 (deferred to v2)

- CodeRabbit-style verification scripts running in sandbox (requires
  Windmill execution overhead — install Windmill first).
- Tool split into `/habakkuk-review` vs `/habakkuk-improve` (v1 is
  single `/habakkuk` invocation; collect usage data first).
- ModernBERT actionability filter (need Marc-action dataset to fine-tune;
  Sonnet judge is the v1 stand-in).
- Agent that actually applies suggested fixes (read-only is doctrine —
  this stays out of scope by design).

## File map

```
habakkuk/
├── README.md                    (this file)
├── __init__.py
├── run.py                       (orchestrator — chains all 6 stages)
├── bin/habakkuk                 (shell wrapper)
├── shared/
│   ├── anti_drift.md            (single source of truth — 7 rules)
│   ├── wku.md                   (single source of truth — Wisdom·Knowledge·Understanding)
│   ├── config.py                (paths, models, token caps, area weights)
│   ├── prompts.py               (preamble loaders)
│   ├── schema.py                (finding schema, deterministic IDs, dedupe keys)
│   ├── llm.py                   (Anthropic SDK wrapper + Langfuse instrumentation)
│   └── diff_utils.py            (git ops, language detection, snippet lookup)
├── rubrics/
│   ├── security.md              (≤500 words; loaded into FAN-OUT system prompt)
│   ├── perf.md
│   ├── ux-a11y.md
│   ├── data-integrity.md
│   ├── api-contracts.md
│   └── tests-coverage.md
├── stages/
│   ├── plan.py                  (Opus 4.7 — PR metadata → plan.md)
│   ├── compress.py              (Python only — bundles per area)
│   ├── fanout.py                (6 Sonnet sub-agents in parallel)
│   ├── verify.py                (Sonnet — independent finding-by-finding)
│   ├── rank.py                  (Opus — structural dedupe + exec-summary)
│   └── present.py               (Sonnet — Marc-facing brief render + .docx)
└── tests/
    ├── test_token_caps.py       (32K hard-cap regression)
    └── test_dedupe.py           (deterministic key collisions)
```
