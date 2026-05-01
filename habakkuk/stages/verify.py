"""
VERIFY stage — Sonnet 4.6.

Receives ONLY the findings JSON files (NOT diff bundles). For each finding:
  1. Look up the claimed snippet by file + line_range from the actual repo
     (HEAD). If file/range invalid → mark `verified: false`,
     reason: "snippet_not_found".
  2. Compare the agent's `snippet` against the actual repo content. If
     they diverge significantly → mark `verified: false`,
     reason: "snippet_mismatch".
  3. Send the finding + actual repo content to a Sonnet validator that
     returns `{verified: bool|inconclusive, reason: str}` per finding.
  4. Drop inconclusive findings AND findings with `confidence < 0.7`.

This stage is the architectural fix for `/ultrareview` — instead of
shoving 24 findings into one consolidator LLM, we verify each finding
INDEPENDENTLY and let structural dedupe at Rank handle collapsing.
"""

from __future__ import annotations

import json
import pathlib
import re
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

from ..shared.config import (
    AREAS, MODEL_VERIFY, VERIFY_DROP_BELOW, ensure_dirs,
)
from ..shared.diff_utils import read_repo_lines
from ..shared.llm import complete
from ..shared.schema import read_findings, write_findings


VERIFY_SYSTEM_TEMPLATE = """{preamble}

## Your task — VERIFY stage

You are independently verifying ONE finding produced by an upstream
fan-out agent. You have:

- The agent's claim, file, line range, and snippet
- The actual repo content for those same lines

Decide ONE thing: does the actual code support the claim?

Output STRICT JSON, no markdown fences:

{{"verified": "true" | "false" | "inconclusive", "reason": "≤200 char explanation"}}

Rules:
- If the actual code clearly demonstrates the claimed problem → "true"
- If the actual code clearly contradicts the claim → "false"
- If the actual code is missing, refactored, or you can't tell from
  what's shown → "inconclusive"
- Do NOT lower the bar to keep findings alive. Inconclusive is the
  honest answer when the snippet doesn't show enough.

Stay inside 1 JSON object. No prose.
"""


def _is_dirty_diff_only_finding(file: str, repo: pathlib.Path) -> bool:
    """If the file doesn't exist at HEAD (rare in this PR pattern but
    possible if the file was deleted in a later commit), we can't verify."""
    return not (repo / file).is_file()


def _heuristic_snippet_match(claimed: str, actual: str | None) -> bool:
    """Cheap pre-filter: do at least 2 of the first 5 non-trivial words of
    the claimed snippet appear in the actual lines? Skips a Sonnet call when
    the snippet is obviously bogus."""
    if not actual:
        return False
    tokens = [t for t in re.findall(r"[A-Za-z_][A-Za-z0-9_]+", claimed) if len(t) > 2]
    if not tokens:
        return True  # snippet has no words to anchor on; let LLM decide
    sample = tokens[:5]
    hits = sum(1 for t in sample if t in actual)
    return hits >= 2


def verify_one(
    *,
    finding: dict,
    repo: pathlib.Path,
    run_dir: pathlib.Path,
    trace_id: str | None = None,
) -> dict:
    from ..shared.prompts import common_preamble

    f = dict(finding)  # don't mutate caller
    actual = read_repo_lines(repo, f["file"], f["line_start"], f["line_end"])

    # ---- structural fast-fails -------------------------------------------
    if _is_dirty_diff_only_finding(f["file"], repo):
        f["verified"] = False
        f["verify_reason"] = "file_not_found_at_head"
        return f
    if actual is None:
        f["verified"] = False
        f["verify_reason"] = "line_range_invalid"
        return f
    if not _heuristic_snippet_match(f.get("snippet", ""), actual):
        f["verified"] = False
        f["verify_reason"] = "snippet_words_absent_from_actual"
        return f

    # ---- LLM judgment ----------------------------------------------------
    preamble = common_preamble("verify")
    system = VERIFY_SYSTEM_TEMPLATE.format(preamble=preamble)
    user = (
        f"Area: {f['area']}\n"
        f"File: {f['file']}\n"
        f"Lines: {f['line_start']}-{f['line_end']}\n"
        f"Claim: {f['claim']}\n"
        f"Suggested fix: {f.get('suggested_fix','')}\n"
        f"Agent confidence: {f['confidence']}\n"
        f"\n"
        f"Snippet (claimed by agent):\n```\n{f.get('snippet','')[:600]}\n```\n"
        f"\n"
        f"Actual repo content for {f['file']}:{f['line_start']}-{f['line_end']}:\n"
        f"```\n{actual[:1200]}\n```\n"
    )

    result = complete(
        stage=f"verify.{f['area']}",
        model=MODEL_VERIFY,
        system=system,
        user=user,
        run_dir=run_dir,
        max_tokens=300,
        temperature=0.0,
        trace_id=trace_id,
    )

    text = result["text"].strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)

    verdict = "inconclusive"
    reason = "parse_error"
    try:
        obj = json.loads(text)
        v = str(obj.get("verified", "inconclusive")).lower()
        if v in ("true", "false", "inconclusive"):
            verdict = v
        reason = str(obj.get("reason", ""))[:200]
    except json.JSONDecodeError:
        pass

    f["verified"] = (verdict == "true") if verdict in ("true", "false") else verdict
    f["verify_reason"] = reason
    return f


def run_verify(
    *,
    repo: pathlib.Path,
    run_dir: pathlib.Path,
    trace_id: str | None = None,
    max_workers: int = 8,
) -> dict:
    ensure_dirs()
    findings_dir = run_dir / "findings"
    all_findings: list[dict] = []
    for area in AREAS:
        all_findings.extend(read_findings(findings_dir / f"{area}.json"))

    verified: list[dict] = []
    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        futures = [
            ex.submit(verify_one, finding=f, repo=repo, run_dir=run_dir, trace_id=trace_id)
            for f in all_findings
        ]
        for fut in as_completed(futures):
            try:
                verified.append(fut.result())
            except Exception as e:
                # Don't let one verify failure tank the run.
                verified.append({"verified": False, "verify_reason": f"exception: {e!r}"})

    # Drop inconclusive + below confidence threshold.
    survivors = [
        f for f in verified
        if f.get("verified") is True
        and float(f.get("confidence", 0.0)) >= VERIFY_DROP_BELOW
    ]
    dropped = len(verified) - len(survivors)

    write_findings(run_dir / "verified.json", survivors)
    meta = {
        "stage": "verify",
        "input_count": len(all_findings),
        "output_count": len(survivors),
        "dropped_count": dropped,
        "drop_below_confidence": VERIFY_DROP_BELOW,
    }
    (run_dir / "verify.meta.json").write_text(
        json.dumps(meta, indent=2), encoding="utf-8"
    )
    return meta
