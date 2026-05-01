"""
PLAN stage — Opus 4.7.

Reads PR metadata only (NOT the diff). Produces an investigation plan:
which areas to fan out, which files belong to which area (as hints, the
COMPRESS stage owns final assignment), and expected risk hotspots.

Output: `<run_dir>/plan.md` — a markdown brief consumed by the fan-out
agents alongside their bundle.

Why Opus: the plan is the highest-leverage decision in the pipeline. It
sets where the 6 Sonnet agents look. Worth the cost.
"""

from __future__ import annotations

import json
import pathlib

from ..shared.config import AREAS, MODEL_PLAN, ensure_dirs
from ..shared.diff_utils import PlanInput
from ..shared.llm import complete


PLAN_SYSTEM_TEMPLATE = """{preamble}

## Your task — PLAN stage

You are the FIRST stage of the Habakkuk pipeline. You receive ONLY the PR
metadata (title, branch, file index with paths/sizes/languages). You do
NOT receive any diff content.

Produce an investigation plan with:

1. **Risk thesis** — a 3-4 sentence assessment of where the most
   significant risk likely lies in this PR, based purely on the file
   index. Cite specific files when relevant.

2. **Per-area focus notes** — for each of the six areas
   (security, perf, ux-a11y, data-integrity, api-contracts, tests-coverage),
   write 2-3 sentences telling the area agent what to pay attention to
   IN THIS SPECIFIC PR. Skip an area only if there are zero relevant
   files (rare).

3. **Hotspot files** — list 3-8 files (paths, exactly as they appear in
   the index) that you suspect are the highest-risk based on size, name,
   or position in the architecture. The fan-out agents will prioritize
   these in their bundles.

4. **Out-of-scope flags** — anything the agents should NOT spend time on
   (vendored code, lockfiles, generated files, etc.).

OUTPUT FORMAT — strict markdown with these exact H2 headings:

## Risk thesis

(your 3-4 sentences)

## Area focus

### security
(your 2-3 sentences)

### perf
(your 2-3 sentences)

### ux-a11y
(your 2-3 sentences)

### data-integrity
(your 2-3 sentences)

### api-contracts
(your 2-3 sentences)

### tests-coverage
(your 2-3 sentences)

## Hotspot files

- path/to/file.ext — one-line reason
- path/to/file.ext — one-line reason
(3 to 8 entries)

## Out of scope

- pattern or path — one-line reason
(0 to 5 entries)

Stop at the end of "Out of scope". Do NOT speculate about specific bugs —
you have not seen the diff.
"""


def run_plan(
    *,
    plan_input: PlanInput,
    run_dir: pathlib.Path,
    trace_id: str | None = None,
) -> dict:
    from ..shared.prompts import common_preamble  # local to keep import order clean

    ensure_dirs()
    run_dir.mkdir(parents=True, exist_ok=True)

    preamble = common_preamble("plan")
    system = PLAN_SYSTEM_TEMPLATE.format(preamble=preamble)
    user = plan_input.to_user_prompt()

    result = complete(
        stage="plan",
        model=MODEL_PLAN,
        system=system,
        user=user,
        run_dir=run_dir,
        max_tokens=2500,
        temperature=0.0,
        trace_id=trace_id,
    )

    plan_md = result["text"].strip()
    (run_dir / "plan.md").write_text(plan_md, encoding="utf-8")

    metadata = {
        "stage": "plan",
        "trace_id": result["trace_id"],
        "model": result["model"],
        "usage": result["usage"],
        "duration_ms": result["duration_ms"],
        "plan_chars": len(plan_md),
    }
    (run_dir / "plan.meta.json").write_text(
        json.dumps(metadata, indent=2), encoding="utf-8"
    )
    return metadata
