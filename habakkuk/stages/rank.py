"""
RANK stage — Opus 4.7.

Reads ONLY verified findings (typically 8-20 records, ~5-15KB total).

Two phases:
  Phase A — Python (no LLM): structural dedupe via deterministic key
    (file, line_start, claim_hash). Within a dedupe group, keep the highest
    severity + highest confidence; merge alternative `suggested_fix` strings
    into a `also_suggested` array. No LLM consolidation. THIS IS THE
    ARCHITECTURAL FIX FOR ULTRAREVIEW.

  Phase B — Opus 4.7 reads the deduped list and produces:
    - `priority_score` per finding (0-100), composed of severity rank ×
      area weight × confidence
    - `executive_summary` — 3 bullets in plain English
    - Optional `notes_on_set` — meta-observations about the finding set
      as a whole

Output: <run_dir>/ranked.json with `findings`, `executive_summary`,
`notes_on_set`, plus the deterministic priority_score on each finding.
"""

from __future__ import annotations

import json
import pathlib
from collections import defaultdict

from ..shared.config import (
    AREA_WEIGHT, MODEL_RANK, SEVERITY_RANK, ensure_dirs,
)
from ..shared.llm import complete
from ..shared.schema import claim_hash, read_findings


RANK_SYSTEM_TEMPLATE = """{preamble}

## Your task — RANK stage (final pass)

You receive an already-deduped, already-verified list of findings.
Structural dedupe is done — your job is NOT to merge or filter further.
Your job is:

1. Write a 3-bullet `executive_summary` in PLAIN ENGLISH suitable for
   a non-engineer (Marc reads these). Each bullet is ONE sentence.
   No jargon. No "the codebase contains" — talk about what was changed
   and what to do about it.

2. Optionally add 1-3 `notes_on_set` — meta-observations about the
   finding set (e.g. "all 4 blockers cluster in one file" or "tests-coverage
   ran but found nothing — green light"). Skip if there's nothing
   noteworthy.

3. Do NOT modify the `findings` array. Do NOT change severities. Do NOT
   add or remove findings. Trust the upstream verification.

OUTPUT — strict JSON, nothing else:

{{
  "executive_summary": ["bullet 1", "bullet 2", "bullet 3"],
  "notes_on_set": ["optional note", ...]
}}

Stay inside this JSON shape. No prose outside it.
"""


def _structural_dedupe(findings: list[dict]) -> list[dict]:
    """
    Group by deterministic key (file, line_start, claim_hash). Within a
    group:
      - severity := max severity across the group
      - confidence := max confidence across the group
      - area := the originating area (preserve), but record `also_areas`
      - suggested_fix := keep the longest, append others to `also_suggested`
    """
    groups: dict[str, list[dict]] = defaultdict(list)
    for f in findings:
        key = f"{f['file']}|{f['line_start']}|{claim_hash(f['file'], f['line_start'], f['claim'])}"
        groups[key].append(f)

    deduped: list[dict] = []
    for key, group in groups.items():
        # Pick the canonical record: highest (severity, confidence)
        group.sort(key=lambda x: (
            -SEVERITY_RANK.get(x.get("severity", "Nit"), 0),
            -float(x.get("confidence", 0.0)),
        ))
        canonical = dict(group[0])
        if len(group) > 1:
            others = group[1:]
            canonical["also_areas"] = sorted({g["area"] for g in others if g["area"] != canonical["area"]})
            alt_fixes = []
            seen = {canonical.get("suggested_fix", "")}
            for g in others:
                fx = g.get("suggested_fix", "")
                if fx and fx not in seen:
                    alt_fixes.append(fx)
                    seen.add(fx)
            if alt_fixes:
                canonical["also_suggested"] = alt_fixes
            canonical["dedupe_size"] = len(group)
        else:
            canonical["dedupe_size"] = 1
        deduped.append(canonical)
    return deduped


def _priority_score(f: dict) -> float:
    sev = SEVERITY_RANK.get(f.get("severity", "Nit"), 0) / 4.0  # 0..1
    weight = AREA_WEIGHT.get(f.get("area", ""), 0.5)
    conf = float(f.get("confidence", 0.5))
    # 100-pt scale, severity dominant
    return round(100.0 * (0.55 * sev + 0.30 * weight + 0.15 * conf), 2)


def run_rank(
    *,
    run_dir: pathlib.Path,
    trace_id: str | None = None,
) -> dict:
    from ..shared.prompts import common_preamble

    ensure_dirs()
    verified = read_findings(run_dir / "verified.json")

    # ---- Phase A: structural dedupe (no LLM) -----------------------------
    deduped = _structural_dedupe(verified)
    for f in deduped:
        f["priority_score"] = _priority_score(f)
    deduped.sort(key=lambda f: -f["priority_score"])

    # ---- Phase B: Opus exec-summary --------------------------------------
    preamble = common_preamble("rank")
    system = RANK_SYSTEM_TEMPLATE.format(preamble=preamble)
    # Pass a compact view to Opus — only the fields it needs.
    compact = [
        {
            "severity": f["severity"],
            "area": f["area"],
            "file": f["file"],
            "line_start": f["line_start"],
            "claim": f["claim"],
            "priority_score": f["priority_score"],
        }
        for f in deduped
    ]
    user = json.dumps({"findings": compact}, indent=2)

    summary = ["No verified findings."]
    notes_on_set: list[str] = []
    rank_meta_extra: dict = {}

    if compact:
        result = complete(
            stage="rank",
            model=MODEL_RANK,
            system=system,
            user=user,
            run_dir=run_dir,
            max_tokens=600,
            temperature=0.0,
            trace_id=trace_id,
        )
        try:
            text = result["text"].strip()
            if text.startswith("```"):
                text = text.split("\n", 1)[1] if "\n" in text else text
                text = text.rsplit("```", 1)[0]
            obj = json.loads(text.strip())
            es = obj.get("executive_summary") or []
            if isinstance(es, list) and es:
                summary = [str(s) for s in es][:5]
            ns = obj.get("notes_on_set") or []
            if isinstance(ns, list):
                notes_on_set = [str(s) for s in ns][:5]
        except (json.JSONDecodeError, KeyError, IndexError):
            summary = ["(rank stage: exec-summary parse failed; see findings below)"]
        rank_meta_extra = {
            "rank_usage": result["usage"],
            "rank_trace_id": result["trace_id"],
            "rank_duration_ms": result["duration_ms"],
        }

    ranked_payload = {
        "findings": deduped,
        "executive_summary": summary,
        "notes_on_set": notes_on_set,
    }
    (run_dir / "ranked.json").write_text(
        json.dumps(ranked_payload, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    meta = {
        "stage": "rank",
        "input_count": len(verified),
        "deduped_count": len(deduped),
        "blockers": sum(1 for f in deduped if f.get("severity") == "Blocker"),
        "majors": sum(1 for f in deduped if f.get("severity") == "Major"),
        "minors": sum(1 for f in deduped if f.get("severity") == "Minor"),
        "nits": sum(1 for f in deduped if f.get("severity") == "Nit"),
        **rank_meta_extra,
    }
    (run_dir / "rank.meta.json").write_text(
        json.dumps(meta, indent=2), encoding="utf-8"
    )
    return meta
