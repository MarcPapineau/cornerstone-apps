"""
FAN-OUT stage — 6 Sonnet 4.6 sub-agents, parallel.

Each agent receives:
- A bundle (one diff bundle, ≤ 24K tokens)
- The plan (loaded from <run_dir>/plan.md)
- Its area's rubric (loaded from rubrics/<area>.md)

Each emits findings.json. Sub-agents return ONLY the JSON path; never
findings inline. This is enforced structurally — we write JSON to disk
and pass paths between stages.

Parallelism uses concurrent.futures.ThreadPoolExecutor — Anthropic's SDK
calls release the GIL during HTTP I/O, so threads parallelize cleanly.
"""

from __future__ import annotations

import json
import pathlib
import re
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

from ..shared.config import (
    AREAS, MODEL_FANOUT, RUBRICS_SOURCE_DIR, SNIPPET_TOKEN_CAP,
    SUGGESTED_FIX_CHAR_CAP, ensure_dirs, estimate_tokens,
)
from ..shared.llm import complete
from ..shared.schema import (
    REQUIRED_FINDING_KEYS, make_finding_id, validate_finding, write_findings,
)


FANOUT_SYSTEM_TEMPLATE = """{preamble}

## Your task — FAN-OUT stage · area: {area}

You are one of six area agents running in parallel. You see ONE diff
bundle (your area's slice of the PR), the PLAN written by the Opus
planner, and your area RUBRIC below.

You will emit a JSON array of findings. Each finding object MUST have
exactly these keys:

- `severity`: one of "Blocker" | "Major" | "Minor" | "Nit"
- `area`: must be exactly "{area}"
- `file`: path as it appears in the bundle (no leading repo prefix)
- `line_start`: integer ≥ 1
- `line_end`: integer ≥ line_start
- `snippet`: ≤ 60 tokens (~240 chars) of the offending code, copied
  verbatim from the bundle
- `claim`: one-sentence statement of the issue, written so it answers
  WKU implicitly
- `suggested_fix`: ≤ 200 chars description (NOT a code patch)
- `confidence`: float in [0.0, 1.0] — your honest probability the
  finding holds up under independent verification

If you have nothing to report, return `[]`. Don't pad with weak findings.

If you noticed something OUTSIDE your area, do NOT file it — append it
to a separate `notes` array (we collect notes in a wrapper object below).

## OUTPUT FORMAT — strict JSON, nothing else

Return EXACTLY this JSON shape, no markdown fences, no preamble, no
trailing prose:

{{"findings": [...], "notes": ["text", ...]}}

If you produce anything other than valid JSON matching this shape, the
Verify stage will reject your entire output.

## Rubric

{rubric}

## Plan (from Opus planner)

{plan}
"""


def _load_rubric(area: str) -> str:
    p = RUBRICS_SOURCE_DIR / f"{area}.md"
    if not p.exists():
        raise FileNotFoundError(
            f"Habakkuk rubric missing for area={area}: expected {p}"
        )
    return p.read_text(encoding="utf-8")


def _trim_snippet(s: str) -> str:
    # 60 tokens × ~4 chars = 240 chars cap, but allow a little slack to
    # finish on a line boundary if possible.
    if estimate_tokens(s) <= SNIPPET_TOKEN_CAP:
        return s
    cap_chars = SNIPPET_TOKEN_CAP * 4
    truncated = s[:cap_chars]
    last_nl = truncated.rfind("\n")
    if last_nl > cap_chars // 2:
        truncated = truncated[:last_nl]
    return truncated + " …"


def _normalize_finding(raw: dict, area: str) -> dict | None:
    """Add the deterministic id, clamp snippets/fixes, ensure types. Returns
    None if the finding can't be salvaged."""
    try:
        norm = {
            "severity": str(raw.get("severity", "")).strip(),
            "area": area,  # force area to match the agent — no cross-filing
            "file": str(raw.get("file", "")).strip(),
            "line_start": int(raw.get("line_start", 0)),
            "line_end": int(raw.get("line_end", 0)),
            "snippet": _trim_snippet(str(raw.get("snippet", ""))),
            "claim": str(raw.get("claim", "")).strip(),
            "suggested_fix": str(raw.get("suggested_fix", ""))[:SUGGESTED_FIX_CHAR_CAP],
            "confidence": float(raw.get("confidence", 0.0)),
        }
    except (TypeError, ValueError):
        return None
    norm["id"] = make_finding_id(
        file=norm["file"],
        line_start=norm["line_start"],
        claim=norm["claim"],
        area=norm["area"],
    )
    ok, _ = validate_finding(norm)
    if not ok:
        return None
    return norm


def _parse_agent_output(text: str) -> tuple[list[dict], list[str], str | None]:
    """Returns (findings, notes, error). Tolerates a leading ```json fence."""
    cleaned = text.strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        obj = json.loads(cleaned)
    except json.JSONDecodeError as e:
        return [], [], f"json_decode_error: {e}"
    if isinstance(obj, list):
        # Some agents skip the wrapper. Accept it.
        return obj, [], None
    if not isinstance(obj, dict):
        return [], [], "output not object/list"
    findings = obj.get("findings", []) or []
    notes = obj.get("notes", []) or []
    if not isinstance(findings, list):
        return [], list(notes) if isinstance(notes, list) else [], "findings not list"
    if not isinstance(notes, list):
        notes = []
    return findings, [str(n) for n in notes], None


def run_one_area(
    *,
    area: str,
    bundle_text: str,
    plan_text: str,
    run_dir: pathlib.Path,
    trace_id: str | None = None,
) -> dict:
    from ..shared.prompts import common_preamble

    rubric = _load_rubric(area)
    preamble = common_preamble("fanout", area=area)
    system = FANOUT_SYSTEM_TEMPLATE.format(
        preamble=preamble, area=area, rubric=rubric, plan=plan_text or "(no plan)",
    )

    result = complete(
        stage=f"fanout.{area}",
        model=MODEL_FANOUT,
        system=system,
        user=bundle_text,
        run_dir=run_dir,
        max_tokens=4096,
        temperature=0.0,
        trace_id=trace_id,
    )

    raw_findings, notes, parse_err = _parse_agent_output(result["text"])
    findings: list[dict] = []
    rejected = 0
    for f in raw_findings:
        if not isinstance(f, dict):
            rejected += 1
            continue
        norm = _normalize_finding(f, area)
        if norm is None:
            rejected += 1
            continue
        findings.append(norm)

    findings_dir = run_dir / "findings"
    findings_dir.mkdir(parents=True, exist_ok=True)
    out_path = findings_dir / f"{area}.json"
    write_findings(out_path, findings)

    meta = {
        "stage": f"fanout.{area}",
        "area": area,
        "model": result["model"],
        "trace_id": result["trace_id"],
        "usage": result["usage"],
        "duration_ms": result["duration_ms"],
        "findings_kept": len(findings),
        "findings_rejected": rejected,
        "notes": notes,
        "parse_error": parse_err,
        "out_path": str(out_path),
    }
    (findings_dir / f"{area}.meta.json").write_text(
        json.dumps(meta, indent=2), encoding="utf-8"
    )
    return meta


def run_fanout(
    *,
    bundles: dict[str, "Bundle"],  # noqa: F821 — type from compress.py
    plan_text: str,
    run_dir: pathlib.Path,
    trace_id: str | None = None,
    max_workers: int = 6,
) -> list[dict]:
    """Fans out one Sonnet call per area in parallel. Returns list of meta
    dicts (one per area)."""
    ensure_dirs()
    metas: list[dict] = []

    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        futures = {
            ex.submit(
                run_one_area,
                area=area,
                bundle_text=bundles[area].text,
                plan_text=plan_text,
                run_dir=run_dir,
                trace_id=trace_id,
            ): area
            for area in AREAS
        }
        for fut in as_completed(futures):
            area = futures[fut]
            try:
                metas.append(fut.result())
            except Exception as e:
                metas.append({
                    "stage": f"fanout.{area}",
                    "area": area,
                    "error": repr(e),
                    "findings_kept": 0,
                })
    metas.sort(key=lambda m: m.get("area", ""))
    (run_dir / "fanout.meta.json").write_text(
        json.dumps(metas, indent=2), encoding="utf-8"
    )
    return metas
